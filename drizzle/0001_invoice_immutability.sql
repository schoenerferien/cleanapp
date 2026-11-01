-- GoBD: Finalisierte Rechnungen und ihre Positionen sind unveränderbar.
-- Erlaubt bleibt nur der Statuswechsel final -> bezahlt.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'entwurf' THEN
      RAISE EXCEPTION 'Finalisierte Rechnung % darf nicht gelöscht werden (GoBD)', OLD.number;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'entwurf' AND NOT (
       OLD.status = 'final' AND NEW.status = 'bezahlt'
       AND NEW.number IS NOT DISTINCT FROM OLD.number
       AND NEW.invoice_date IS NOT DISTINCT FROM OLD.invoice_date
       AND NEW.customer_id = OLD.customer_id
       AND NEW.net_cents = OLD.net_cents AND NEW.vat_cents = OLD.vat_cents AND NEW.total_cents = OLD.total_cents
       AND NEW.tenant_snapshot IS NOT DISTINCT FROM OLD.tenant_snapshot
       AND NEW.customer_snapshot IS NOT DISTINCT FROM OLD.customer_snapshot
     ) THEN
    RAISE EXCEPTION 'Finalisierte Rechnung % ist unveränderbar (GoBD)', OLD.number;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF parent_status IS NOT NULL AND parent_status <> 'entwurf' THEN
    RAISE EXCEPTION 'Positionen finalisierter Rechnungen sind unveränderbar (GoBD)';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
