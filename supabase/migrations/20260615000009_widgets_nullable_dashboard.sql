-- Allow widgets to exist without a dashboard (detached / standalone)
ALTER TABLE public.widgets ALTER COLUMN dashboard_id DROP NOT NULL;
