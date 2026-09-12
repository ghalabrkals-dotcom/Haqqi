CREATE TABLE public.receivables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(14,3) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KWD',
  type TEXT NOT NULL,
  owed_by TEXT NOT NULL,
  date_owed DATE NOT NULL,
  expected_return_type TEXT NOT NULL DEFAULT 'unknown' CHECK (expected_return_type IN ('exact_date','business_days','unknown')),
  expected_date DATE,
  min_business_days INTEGER CHECK (min_business_days >= 0),
  max_business_days INTEGER CHECK (max_business_days >= 0),
  payment_method TEXT,
  reference_number TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivables TO authenticated;
GRANT ALL ON public.receivables TO service_role;

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own receivables" ON public.receivables FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own receivables" ON public.receivables FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own receivables" ON public.receivables FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own receivables" ON public.receivables FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX receivables_user_created_idx ON public.receivables (user_id, created_at DESC);

CREATE TRIGGER receivables_set_updated_at BEFORE UPDATE ON public.receivables FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();