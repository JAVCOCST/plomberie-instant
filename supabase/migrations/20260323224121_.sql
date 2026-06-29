-- QB Products cache
CREATE TABLE IF NOT EXISTS public.qb_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qb_id text NOT NULL UNIQUE,
  name text NOT NULL,
  type text,
  unit_price numeric,
  purchase_cost numeric,
  sku text,
  description text,
  income_account_name text,
  expense_account_name text,
  active boolean DEFAULT true,
  raw_data jsonb,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.qb_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_qb_products" ON public.qb_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_qb_products" ON public.qb_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_qb_products" ON public.qb_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_qb_products" ON public.qb_products FOR DELETE TO authenticated USING (true);

-- QB Customers cache
CREATE TABLE IF NOT EXISTS public.qb_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qb_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  company_name text,
  email text,
  phone text,
  mobile text,
  bill_address text,
  balance numeric DEFAULT 0,
  raw_data jsonb,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.qb_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_qb_customers" ON public.qb_customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_qb_customers" ON public.qb_customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_qb_customers" ON public.qb_customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_qb_customers" ON public.qb_customers FOR DELETE TO authenticated USING (true);
