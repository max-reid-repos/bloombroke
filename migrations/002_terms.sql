-- When the buyer ticked "I agree to the Terms" at Stripe Checkout (consent_collection).
-- Milliseconds since the epoch; NULL for a checkout without the consent field.
ALTER TABLE licences ADD COLUMN terms_accepted_at INTEGER;
