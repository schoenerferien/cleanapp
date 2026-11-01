import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/bits";
import { SiteForm } from "@/components/site-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, schema } from "@/db";
import { updateSite } from "@/server/actions/masterdata";
import { requireOwner } from "@/server/session";

export default async function SiteEditPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const me = await requireOwner();
  const [site] = await db
    .select()
    .from(schema.sites)
    .where(and(eq(schema.sites.id, siteId), eq(schema.sites.tenantId, me.tenantId)));
  if (!site) notFound();

  return (
    <>
      <PageHeader title={`Objekt bearbeiten`} description={site.name}>
        <Button variant="outline" asChild>
          <Link href={`/kunden/${site.customerId}`}>Zurück</Link>
        </Button>
      </PageHeader>
      <Card className="max-w-3xl">
        <CardContent>
          <SiteForm action={updateSite.bind(null, site.id)} site={site} submitLabel="Speichern" />
        </CardContent>
      </Card>
    </>
  );
}
