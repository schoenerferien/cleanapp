-- GoBD: Finalisierte Rechnungen und ihre Positionen sind unveränderbar.
-- Erlaubt bleiben nur zwei Statuswechsel:
--   final -> bezahlt
--   final/bezahlt -> storniert, wenn dazu eine finalisierte Stornorechnung existiert
-- Alle Inhalte (Nummer, Datum, Beträge, Empfänger, Art, Verweis) bleiben dabei gleich.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'entwurf' THEN
      RAISE EXCEPTION 'Finalisierte Rechnung % darf nicht gelöscht werden (GoBD)', OLD.number;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'entwurf' AND NOT (
       (
         (OLD.status = 'final' AND NEW.status = 'bezahlt')
         OR (
           OLD.status IN ('final', 'bezahlt') AND NEW.status = 'storniert' AND OLD.kind = 'rechnung'
           AND NEW.paid_at IS NOT DISTINCT FROM OLD.paid_at
           AND EXISTS (SELECT 1 FROM invoices s WHERE s.cancels_invoice_id = OLD.id AND s.kind = 'storno' AND s.status = 'final')
         )
       )
       AND NEW.number IS NOT DISTINCT FROM OLD.number
       AND NEW.invoice_date IS NOT DISTINCT FROM OLD.invoice_date
       AND NEW.customer_id = OLD.customer_id
       AND NEW.period_month = OLD.period_month
       AND NEW.kleinunternehmer = OLD.kleinunternehmer
       AND NEW.kind = OLD.kind
       AND NEW.cancels_invoice_id IS NOT DISTINCT FROM OLD.cancels_invoice_id
       AND NEW.finalized_at IS NOT DISTINCT FROM OLD.finalized_at
       AND NEW.net_cents = OLD.net_cents AND NEW.vat_cents = OLD.vat_cents AND NEW.total_cents = OLD.total_cents
       AND NEW.tenant_snapshot IS NOT DISTINCT FROM OLD.tenant_snapshot
       AND NEW.customer_snapshot IS NOT DISTINCT FROM OLD.customer_snapshot
     ) THEN
    RAISE EXCEPTION 'Finalisierte Rechnung % ist unveränderbar (GoBD)', OLD.number;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
