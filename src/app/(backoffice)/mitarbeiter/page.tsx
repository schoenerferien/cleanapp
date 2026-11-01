import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Field, PageHeader, selectClass } from "@/components/bits";
import { SubmitButton } from "@/components/client-bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { employmentLabel, euro } from "@/domain/format";
import { isBelowMinWage, minWageAt } from "@/domain/limits";
import { todayBerlin } from "@/domain/time";
import { createEmployee } from "@/server/actions/masterdata";
import { listEmployees } from "@/server/queries";
import { requireOwner } from "@/server/session";

export default async function EmployeesPage() {
  const me = await requireOwner();
  const employees = await listEmployees(me.tenantId);
  const today = todayBerlin();

  return (
    <>
      <PageHeader title="Mitarbeiter" description="Mitarbeitende melden sich in der App mit Benutzername und 6-stelliger PIN an." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Benutzername</TableHead>
                  <TableHead>Beschäftigung</TableHead>
                  <TableHead className="text-right">Stundenlohn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow key={e.id} className={e.active ? "" : "opacity-50"}>
                    <TableCell>
                      <Link href={`/mitarbeiter/${e.id}`} className="font-medium hover:underline">
                        {e.name}
                      </Link>
                      {!e.active && <span className="ml-2 text-xs">(inaktiv)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.username}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{employmentLabel[e.employmentType ?? ""] ?? "–"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isBelowMinWage(e.hourlyWageCents, today) && (
                        <TriangleAlert className="mr-1 inline size-4 text-red-600" aria-label="unter Branchenmindestlohn" />
                      )}
                      {e.hourlyWageCents != null ? euro(e.hourlyWageCents) : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Neue Person</CardTitle>
            <CardDescription>Branchenmindestlohn Gebäudereinigung (LG 1): {euro(minWageAt(today))}/Std.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createEmployee} className="space-y-3">
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Benutzername">
                  <Input name="username" autoCapitalize="none" required />
                </Field>
                <Field label="PIN (6 Ziffern)">
                  <Input name="pin" inputMode="numeric" pattern="\d{6}" required />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Beschäftigung">
                  <select name="employmentType" className={selectClass} defaultValue="minijob">
                    <option value="minijob">Minijob</option>
                    <option value="teilzeit">Teilzeit</option>
                    <option value="vollzeit">Vollzeit</option>
                  </select>
                </Field>
                <Field label="Stundenlohn €">
                  <Input name="wage" inputMode="decimal" defaultValue="15,00" required />
                </Field>
              </div>
              <Field label="Telefon">
                <Input name="phone" type="tel" />
              </Field>
              <SubmitButton className="w-full">Anlegen</SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
