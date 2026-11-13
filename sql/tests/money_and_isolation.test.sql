-- Database checks for the money functions and shop isolation.
-- Run by scripts/db_test.sh against a database built by scripts/db_build.sh.
-- Each check raises an error when it fails. Everything is rolled back at the end.
\set ON_ERROR_STOP on
BEGIN;

-- Two shops, one user and one login session each
INSERT INTO shops (id, name) VALUES (9001, 'Test Shop A'), (9002, 'Test Shop B');
INSERT INTO users (id, username, password, role, shop_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'test_a', 'x', 'admin', 9001),
  ('00000000-0000-4000-8000-00000000000b', 'test_b', 'x', 'admin', 9002);
INSERT INTO sessions (user_id, shop_id, token) VALUES
  ('00000000-0000-4000-8000-00000000000a', 9001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('00000000-0000-4000-8000-00000000000b', 9002, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

INSERT INTO customers (id, shop_id, name, outstanding_balance) VALUES (9101, 9001, 'Ali', 600), (9102, 9002, 'Other shop customer', 0);
INSERT INTO suppliers (id, shop_id, name, outstanding_balance) VALUES (9201, 9001, 'Badar iPhone Store', 1000);
INSERT INTO products (id, shop_id, name, stock_quantity) VALUES (9301, 9001, 'Cable', 10);
INSERT INTO bank_accounts (id, shop_id, account_name, bank_name, current_balance, opening_balance) VALUES
  (9401, 9001, 'Cash in Hand', 'Cash', 1000, 1000), (9402, 9002, 'Other shop cash', 'Cash', 50, 50);
INSERT INTO sales (id, shop_id, customer_id, total_amount, discount, net_amount, paid_amount) VALUES
  (9501, 9001, 9101, 1000, 0, 1000, 400), (9502, 9002, 9102, 50, 0, 50, 50);
INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price) VALUES (9601, 9501, 9301, 2, 500), (9602, 9502, NULL, 1, 50);

-- Log in as a shop the way the app does: the session token travels in a request header
CREATE FUNCTION pg_temp.login(p_token TEXT) RETURNS VOID LANGUAGE sql AS
$$ SELECT set_config('request.headers', json_build_object('x-session-token', p_token)::text, false) $$;
CREATE FUNCTION pg_temp.fails(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS
$$ BEGIN EXECUTE p_sql; RETURN FALSE; EXCEPTION WHEN OTHERS THEN RETURN TRUE; END $$;

SET ROLE anon;
SELECT pg_temp.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

DO $$
DECLARE r JSONB; n NUMERIC;
BEGIN
  ASSERT public.current_user_shop_id() = 9001, 'session resolves to shop A';

  -- 1. Shop isolation on the bank tables (they used to be open to every shop)
  ASSERT (SELECT count(*) FROM bank_accounts) = 1, 'shop A sees only its own account';
  UPDATE bank_accounts SET current_balance = 1 WHERE id = 9402;
  ASSERT NOT FOUND, 'shop A cannot change shop B account';
  ASSERT pg_temp.fails($q$ INSERT INTO bank_accounts (shop_id, account_name, bank_name) VALUES (9002, 'x', 'x') $q$), 'cannot create an account in another shop';

  -- 2. Bank balance moves by an amount, statement entry carries true before / after
  r := adjust_bank_balance(9401, 500, 'SALE', '77', 'POS sale', '11111111-1111-4111-8111-111111111111');
  ASSERT (r ->> 'balance_before')::numeric = 1000 AND (r ->> 'balance_after')::numeric = 1500, 'deposit applied';
  r := adjust_bank_balance(9401, 500, 'SALE', '77', 'POS sale', '11111111-1111-4111-8111-111111111111');
  ASSERT (r ->> 'duplicate')::boolean, 'same op id is not applied twice';
  ASSERT (SELECT current_balance FROM bank_accounts WHERE id = 9401) = 1500, 'balance unchanged by the replay';
  ASSERT pg_temp.fails($q$ SELECT adjust_bank_balance(9402, 5) $q$), 'cannot move money in another shop account';

  -- 3. Correcting an entry: 230,000 typed for 23,000
  r := adjust_bank_balance(9401, -230000, 'purchase', '9', 'Badar iPhone Store', NULL);
  PERFORM adjust_bank_balance(9401, 100, 'deposit', NULL, 'later entry', NULL);
  r := edit_bank_transaction((r #>> '{transaction,id}')::bigint, 23000, 'withdrawal', NULL, NULL, 'extra zero typed');
  ASSERT (r ->> 'balance_change')::numeric = 207000, 'balance moves by the difference only';
  ASSERT (SELECT current_balance FROM bank_accounts WHERE id = 9401) = 1500 - 23000 + 100, 'account balance corrected';
  ASSERT (SELECT balance_after FROM bank_account_transactions WHERE account_id = 9401 ORDER BY id DESC LIMIT 1) = 1500 - 23000 + 100,
         'later entries keep a consistent running balance';

  -- 4. One-step customer payment: entry + balance + account together
  n := (SELECT current_balance FROM bank_accounts WHERE id = 9401);
  r := apply_money_op(jsonb_build_object(
         'inserts', jsonb_build_array(jsonb_build_object('table', 'customer_payments', 'row',
                      jsonb_build_object('customer_id', 9101, 'amount', 300, 'payment_type', 'payment', 'shop_id', 9002, 'no_such_column', 1))),
         'customer', jsonb_build_object('id', 9101, 'delta', -300),
         'accounts', jsonb_build_array(jsonb_build_object('account_id', 9401, 'delta', 300, 'reference_type', 'CUSTOMER_PAYMENT'))));
  ASSERT (r #>> '{inserted,0,row,shop_id}')::int = 9001, 'shop id is always the caller''s, whatever the row says';
  ASSERT (SELECT outstanding_balance FROM customers WHERE id = 9101) = 300, 'customer balance reduced';
  ASSERT (SELECT current_balance FROM bank_accounts WHERE id = 9401) = n + 300, 'cash account credited';

  -- 5. All or nothing: a bad part undoes the whole action
  ASSERT pg_temp.fails($q$ SELECT apply_money_op('{"inserts":[{"table":"customer_payments","row":{"customer_id":9101,"amount":10}}],"customer":{"id":9102,"delta":-10}}'::jsonb) $q$),
         'payment against another shop''s customer is refused';
  ASSERT (SELECT count(*) FROM customer_payments WHERE customer_id = 9101) = 1, 'the refused action left no entry behind';
  ASSERT pg_temp.fails($q$ SELECT apply_money_op('{"updates":[{"table":"sales","id":"9502","set":{"paid_amount":0}}]}'::jsonb) $q$), 'cannot change another shop''s sale';
  ASSERT pg_temp.fails($q$ SELECT apply_money_op('{"updates":[{"table":"sale_items","id":"9602","set":{"returned_qty":1}}]}'::jsonb) $q$), 'cannot change another shop''s sale line';
  ASSERT pg_temp.fails($q$ SELECT apply_money_op('{"inserts":[{"table":"users","row":{"username":"x"}}]}'::jsonb) $q$), 'only money tables can be written';
  ASSERT pg_temp.fails($q$ SELECT apply_money_op('{"deletes":[{"table":"sales","id":"9501"}]}'::jsonb) $q$), 'sales cannot be deleted through it';

  -- 6. One-step sale return: line, invoice totals, stock, balance and cash refund
  n := (SELECT current_balance FROM bank_accounts WHERE id = 9401);
  PERFORM apply_money_op('{"updates":[{"table":"sale_items","id":"9601","set":{"returned_qty":1}},
                                     {"table":"sales","id":"9501","set":{"total_amount":500,"net_amount":500,"paid_amount":0}}],
                          "stock":[{"product_id":9301,"delta":1}],
                          "customer":{"id":9101,"delta":-100},
                          "accounts":[{"account_id":9401,"delta":-400,"reference_type":"sale_return","reference_id":"9501"}]}'::jsonb);
  ASSERT (SELECT returned_qty FROM sale_items WHERE id = 9601) = 1, 'returned quantity saved';
  ASSERT (SELECT stock_quantity FROM products WHERE id = 9301) = 11, 'stock put back';
  ASSERT (SELECT outstanding_balance FROM customers WHERE id = 9101) = 200, 'customer balance reduced by the unpaid part';
  ASSERT (SELECT current_balance FROM bank_accounts WHERE id = 9401) = n - 400, 'cash refund left the cash account';

  -- 7. Expense: add, correct, delete; the account follows each time
  n := (SELECT current_balance FROM bank_accounts WHERE id = 9401);
  r := apply_money_op('{"inserts":[{"table":"expenses","row":{"amount":50,"category":"Tea","account_id":9401,"payment_method":"cash"}}],
                       "accounts":[{"account_id":9401,"delta":-50,"reference_type":"expense"}]}'::jsonb);
  ASSERT (r #>> '{inserted,0,row,account_id}')::bigint = 9401, 'expense remembers its account';
  PERFORM apply_money_op(jsonb_build_object(
            'deletes', jsonb_build_array(jsonb_build_object('table', 'expenses', 'id', r #>> '{inserted,0,row,id}')),
            'accounts', jsonb_build_array(jsonb_build_object('account_id', 9401, 'delta', 50, 'reference_type', 'expense_reversal'))));
  ASSERT (SELECT current_balance FROM bank_accounts WHERE id = 9401) = n, 'deleting the expense gave the money back';

  -- 8. Balance check: stored balance equals what the statement adds up to
  ASSERT (SELECT count(*) FROM check_bank_balances()) = 1, 'balance check lists only this shop';
  ASSERT (SELECT difference FROM check_bank_balances() WHERE account_id = 9401) = 0, 'balance matches its statement';

  -- 9. Customer / supplier balances change by an amount, own shop only
  PERFORM adjust_supplier_balance(9201, -250, NULL);
  ASSERT (SELECT outstanding_balance FROM suppliers WHERE id = 9201) = 750, 'supplier balance reduced';
  ASSERT pg_temp.fails($q$ SELECT adjust_customer_balance(9102, 5, NULL) $q$), 'cannot change another shop''s customer';
END $$;

-- The other shop saw none of it
SELECT pg_temp.login('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
DO $$
BEGIN
  ASSERT public.current_user_shop_id() = 9002, 'session resolves to shop B';
  ASSERT (SELECT count(*) FROM bank_accounts) = 1 AND (SELECT current_balance FROM bank_accounts) = 50, 'shop B account untouched';
  ASSERT (SELECT count(*) FROM bank_account_transactions) = 0, 'shop B sees none of shop A''s entries';
  ASSERT (SELECT count(*) FROM customers) = 1, 'shop B sees only its own customers';
END $$;

-- Not logged in: nothing is visible and nothing can be changed
SELECT set_config('request.headers', '{}', false);
DO $$
BEGIN
  ASSERT public.current_user_shop_id() IS NULL, 'no session, no shop';
  ASSERT (SELECT count(*) FROM bank_accounts) = 0, 'no session sees no accounts';
  ASSERT pg_temp.fails($q$ SELECT adjust_bank_balance(9401, 5) $q$), 'no session cannot move money';
  ASSERT pg_temp.fails($q$ SELECT apply_money_op('{"inserts":[{"table":"expenses","row":{"amount":1,"category":"x"}}]}'::jsonb) $q$), 'no session cannot save';
END $$;

RESET ROLE;
ROLLBACK;
\echo 'money_and_isolation: all checks passed'
