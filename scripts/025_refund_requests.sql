-- Buyer refund tracking after dispute resolution (Phase C — demo or live B2C)
-- Run after 024_dispute_routing.sql

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.disputes (id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.transactions (id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  phone VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  simulated BOOLEAN NOT NULL DEFAULT false,
  mpesa_transaction_id TEXT,
  result_desc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_dispute ON public.refund_requests (dispute_id);
CREATE INDEX IF NOT EXISTS idx_refund_transaction ON public.refund_requests (transaction_id);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_select_own ON public.refund_requests;
CREATE POLICY refund_select_own
  ON public.refund_requests
  FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid());

GRANT SELECT ON public.refund_requests TO authenticated;
GRANT ALL ON public.refund_requests TO service_role;

COMMENT ON TABLE public.refund_requests IS 'M-Pesa B2C refunds to buyer after dispute; REFUND_DEMO_MODE completes instantly for presentations.';
