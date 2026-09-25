-- Licences made before livemode was recorded: take the mode from the checkout session id.
UPDATE licences SET livemode = CASE WHEN checkout_session_id LIKE 'cs_test_%' THEN 0 WHEN checkout_session_id LIKE 'cs_live_%' THEN 1 END WHERE livemode IS NULL;
