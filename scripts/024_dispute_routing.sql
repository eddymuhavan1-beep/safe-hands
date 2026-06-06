-- Dispute routing & decision-support columns (Phase B)
-- Run in Supabase SQL editor after 017_dispute_atomic_rpc.sql

ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS dispute_queue text NOT NULL DEFAULT 'standard'
  CHECK (dispute_queue IN ('standard', 'priority', 'triage', 'auto_suggest'));

ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS recommended_resolution text
  CHECK (
    recommended_resolution IS NULL
    OR recommended_resolution IN ('refund_buyer', 'release_to_seller', 'partial_refund', 'cancelled')
  );

ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS recommended_reason text;

CREATE INDEX IF NOT EXISTS idx_disputes_queue_status
  ON public.disputes (dispute_queue, status);

COMMENT ON COLUMN public.disputes.dispute_queue IS 'Admin routing: standard, priority, triage, auto_suggest';
COMMENT ON COLUMN public.disputes.recommended_resolution IS 'Informational suggestion only until admin confirms';
