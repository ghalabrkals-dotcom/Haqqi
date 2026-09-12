CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  sender_name TEXT NOT NULL CHECK (char_length(trim(sender_name)) > 0 AND char_length(sender_name) <= 120),
  amount NUMERIC(14,3) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KWD' CHECK (char_length(currency) = 3),
  reference TEXT CHECK (reference IS NULL OR char_length(reference) <= 120),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  matched_receivable_id UUID REFERENCES public.receivables(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_transactions TO authenticated;
GRANT ALL ON public.bank_transactions TO service_role;

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own demo transactions" ON public.bank_transactions;
CREATE POLICY "Users manage their own demo transactions"
ON public.bank_transactions FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS bank_transactions_user_idx ON public.bank_transactions (user_id, transaction_date DESC);

CREATE OR REPLACE FUNCTION public.set_bank_transactions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_bank_transactions_updated_at ON public.bank_transactions;
CREATE TRIGGER update_bank_transactions_updated_at
BEFORE UPDATE ON public.bank_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_bank_transactions_updated_at();