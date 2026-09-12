CREATE TABLE public.receivable_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receivable_id UUID NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  received_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX receivable_payments_receivable_id_idx ON public.receivable_payments (receivable_id);
CREATE INDEX receivable_payments_user_id_idx ON public.receivable_payments (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivable_payments TO authenticated;
GRANT ALL ON public.receivable_payments TO service_role;

ALTER TABLE public.receivable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own payments"
ON public.receivable_payments FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);