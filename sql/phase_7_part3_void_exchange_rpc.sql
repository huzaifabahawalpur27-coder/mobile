CREATE OR REPLACE FUNCTION void_phone_exchange(
    p_exchange_id INTEGER,
    p_void_reason TEXT DEFAULT 'Customer requested reversal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_role TEXT;
    v_exchange RECORD;
    v_item RECORD;
    v_phone RECORD;
    v_acc_bal_before NUMERIC;
    v_acc_bal_after NUMERIC;
    v_split_item JSONB;
    v_split_acc_id BIGINT;
    v_split_amt NUMERIC;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT s.user_id, s.shop_id, u.role
    INTO v_user_id, v_shop_id, v_role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = v_token AND (s.expires_at IS NULL OR s.expires_at > NOW());

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired');
    END IF;

    IF v_role NOT IN ('admin', 'superadmin', 'manager') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Only admins and managers can void exchanges');
    END IF;

    -- Lock exchange row
    SELECT * INTO v_exchange
    FROM exchanges
    WHERE id = p_exchange_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Exchange record not found');
    END IF;

    IF v_exchange.status = 'voided' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Exchange has already been voided');
    END IF;

    -- 1. Safety Check: Verify traded-in phones have not been sold/issued
    FOR v_item IN
        SELECT * FROM exchange_items
        WHERE exchange_id = p_exchange_id AND item_direction = 'incoming_trade_in'
    LOOP
        IF v_item.phone_id IS NOT NULL THEN
            SELECT * INTO v_phone FROM phones WHERE id = v_item.phone_id;
            IF FOUND AND v_phone.status != 'in_stock' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', format('Cannot void exchange: Traded-in phone %s %s (IMEI: %s) has already been altered! Current status: %s', v_phone.brand, v_phone.model, v_phone.imei_1, v_phone.status)
                );
            END IF;
        END IF;
    END LOOP;

    -- 2. Restore Outgoing Items to Stock
    FOR v_item IN
        SELECT * FROM exchange_items
        WHERE exchange_id = p_exchange_id AND item_direction = 'outgoing_sale'
    LOOP
        IF v_item.phone_id IS NOT NULL THEN
            UPDATE phones
            SET status = 'in_stock',
                sale_id = NULL,
                sold_at = NULL,
                updated_at = NOW()
            WHERE id = v_item.phone_id;

            INSERT INTO phone_history (
                phone_id,
                shop_id,
                action,
                from_status,
                to_status,
                reference_id,
                performed_by,
                details
            ) VALUES (
                v_item.phone_id,
                v_shop_id,
                'exchange_voided',
                'sold',
                'in_stock',
                v_exchange.exchange_number,
                v_user_id,
                jsonb_build_object('reason', p_void_reason, 'exchange_id', p_exchange_id)
            );
        ELSIF v_item.product_id IS NOT NULL THEN
            UPDATE products
            SET stock_quantity = stock_quantity + v_item.quantity,
                updated_at = NOW()
            WHERE id = v_item.product_id;
        END IF;
    END LOOP;

    -- 3. Return Traded-in Phones to Customer (mark returned)
    FOR v_item IN
        SELECT * FROM exchange_items
        WHERE exchange_id = p_exchange_id AND item_direction = 'incoming_trade_in'
    LOOP
        IF v_item.phone_id IS NOT NULL THEN
            UPDATE phones
            SET status = 'returned',
                notes = COALESCE(notes, '') || format(' [Voided Exchange %s: %s]', v_exchange.exchange_number, p_void_reason),
                updated_at = NOW()
            WHERE id = v_item.phone_id;

            INSERT INTO phone_history (
                phone_id,
                shop_id,
                action,
                from_status,
                to_status,
                reference_id,
                performed_by,
                details
            ) VALUES (
                v_item.phone_id,
                v_shop_id,
                'returned_to_customer',
                'in_stock',
                'returned',
                v_exchange.exchange_number,
                v_user_id,
                jsonb_build_object('reason', p_void_reason, 'exchange_id', p_exchange_id)
            );
        END IF;
    END LOOP;

    -- 4. Reversal of Financial Settlement
    IF v_exchange.settlement_direction = 'customer_paid' AND v_exchange.settlement_amount > 0 THEN
        -- Money was received from customer -> Refund/Debit it back out
        IF v_exchange.settlement_payment_method = 'split' AND v_exchange.settlement_payment_details IS NOT NULL THEN
            FOR v_split_item IN SELECT * FROM jsonb_array_elements(v_exchange.settlement_payment_details) LOOP
                v_split_amt := (v_split_item->>'amount')::NUMERIC;
                v_split_acc_id := (v_split_item->>'account_id')::BIGINT;

                IF v_split_amt > 0 AND v_split_acc_id IS NOT NULL THEN
                    SELECT current_balance INTO v_acc_bal_before
                    FROM bank_accounts
                    WHERE id = v_split_acc_id AND shop_id = v_shop_id
                    FOR UPDATE;

                    IF FOUND THEN
                        v_acc_bal_after := v_acc_bal_before - v_split_amt;
                        UPDATE bank_accounts
                        SET current_balance = v_acc_bal_after, updated_at = NOW()
                        WHERE id = v_split_acc_id;

                        INSERT INTO bank_account_transactions (
                            shop_id,
                            account_id,
                            transaction_type,
                            amount,
                            balance_before,
                            balance_after,
                            reference_type,
                            reference_id,
                            description,
                            created_at
                        ) VALUES (
                            v_shop_id,
                            v_split_acc_id,
                            'withdrawal',
                            v_split_amt,
                            v_acc_bal_before,
                            v_acc_bal_after,
                            'EXCHANGE_VOID_REFUND',
                            v_exchange.exchange_number,
                            format('Void refund for Exchange %s', v_exchange.exchange_number),
                            NOW()
                        );
                    END IF;
                END IF;
            END LOOP;
        ELSIF v_exchange.settlement_account_id IS NOT NULL THEN
            SELECT current_balance INTO v_acc_bal_before
            FROM bank_accounts
            WHERE id = v_exchange.settlement_account_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF FOUND THEN
                v_acc_bal_after := v_acc_bal_before - v_exchange.settlement_amount;
                UPDATE bank_accounts
                SET current_balance = v_acc_bal_after, updated_at = NOW()
                WHERE id = v_exchange.settlement_account_id;

                INSERT INTO bank_account_transactions (
                    shop_id,
                    account_id,
                    transaction_type,
                    amount,
                    balance_before,
                    balance_after,
                    reference_type,
                    reference_id,
                    description,
                    created_at
                ) VALUES (
                    v_shop_id,
                    v_exchange.settlement_account_id,
                    'withdrawal',
                    v_exchange.settlement_amount,
                    v_acc_bal_before,
                    v_acc_bal_after,
                    'EXCHANGE_VOID_REFUND',
                    v_exchange.exchange_number,
                    format('Void refund for Exchange %s', v_exchange.exchange_number),
                    NOW()
                );
            END IF;
        END IF;

    ELSIF v_exchange.settlement_direction = 'shop_payout' AND v_exchange.settlement_amount > 0 THEN
        -- Shop had paid customer -> Re-deposit/Credit it back in
        IF v_exchange.settlement_account_id IS NOT NULL THEN
            SELECT current_balance INTO v_acc_bal_before
            FROM bank_accounts
            WHERE id = v_exchange.settlement_account_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF FOUND THEN
                v_acc_bal_after := v_acc_bal_before + v_exchange.settlement_amount;
                UPDATE bank_accounts
                SET current_balance = v_acc_bal_after, updated_at = NOW()
                WHERE id = v_exchange.settlement_account_id;

                INSERT INTO bank_account_transactions (
                    shop_id,
                    account_id,
                    transaction_type,
                    amount,
                    balance_before,
                    balance_after,
                    reference_type,
                    reference_id,
                    description,
                    created_at
                ) VALUES (
                    v_shop_id,
                    v_exchange.settlement_account_id,
                    'deposit',
                    v_exchange.settlement_amount,
                    v_acc_bal_before,
                    v_acc_bal_after,
                    'EXCHANGE_VOID_RECOVERY',
                    v_exchange.exchange_number,
                    format('Void recovery of payout for Exchange %s', v_exchange.exchange_number),
                    NOW()
                );
            END IF;
        END IF;
    END IF;

    -- 5. Mark Master Records Voided
    UPDATE exchanges
    SET status = 'voided',
        voided_at = NOW(),
        voided_by = v_user_id,
        void_reason = p_void_reason,
        updated_at = NOW()
    WHERE id = p_exchange_id;

    IF v_exchange.sale_id IS NOT NULL THEN
        UPDATE sales SET status = 'voided' WHERE id = v_exchange.sale_id;
    END IF;

    IF v_exchange.purchase_id IS NOT NULL THEN
        UPDATE purchases
        SET remarks = COALESCE(remarks, '') || format(' [VOIDED: %s]', p_void_reason)
        WHERE id = v_exchange.purchase_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'exchange_id', p_exchange_id,
        'exchange_number', v_exchange.exchange_number,
        'message', 'Exchange successfully voided and inventory/balances restored'
    );
END;
$func$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION process_phone_exchange TO anon, authenticated;
GRANT EXECUTE ON FUNCTION void_phone_exchange TO anon, authenticated;


