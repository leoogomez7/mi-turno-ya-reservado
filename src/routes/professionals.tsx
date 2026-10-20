import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { professionalStore, type Professional, type ProfessionalService } from "@/lib/professional-store";

const defaultFormState: Partial<Professional> = {
  name: "",
  specialty: "",
  address: "",
  availableSlots: [],
  services: [],
  scheduleDates: [],
};

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? "";

export const Route = createFileRoute("/professionals")({
  head: () => ({ meta: [{ title: "Profesionales" }] }),
  component: ProfessionalsPage,
});

export function ProfessionalsManager() {
  const formRef = useRef<HTMLDivElement | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Professional>>(defaultFormState);

  const [adminPasswordDialogOpen, setAdminPasswordDialogOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState<"save" | "delete" | "modify" | null>(null);
  const [pendingProfessionalId, setPendingProfessionalId] = useState<string | null>(null);
  const [passwordPromptText, setPasswordPromptText] = useState("");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"schedule" | "services">("schedule");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  useEffect(() => {
    const load = () => setProfessionals(professionalStore.all());
    load();
    window.addEventListener("professionals:changed", load);
    return () => window.removeEventListener("professionals:changed", load);
  }, []);

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === editingId) ?? null,
    [professionals, editingId]
  );

  useEffect(() => {
    if (selectedProfessional) {
      setForm({
        name: selectedProfessional.name,
        specialty: selectedProfessional.specialty,
        address: selectedProfessional.address ?? "",
        availableSlots: selectedProfessional.availableSlots,
        services: selectedProfessional.services,
        scheduleDates: selectedProfessional.scheduleDates ?? [],
      });
    } else {
      setForm(defaultFormState);
    }
  }, [selectedProfessional]);

  useEffect(() => {
    if (!showForm) return;
    const timeout = window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [showForm]);

  function ensurePassword(passwordToCheck: string): boolean {
    if (passwordToCheck !== ADMIN_PASSWORD) {
      toast.error("Contraseña incorrecta.");
      return false;
    }
    return true;
  }

  function openAdminPasswordDialog(
    promptText: string,
    action: "save" | "delete" | "modify",
    professionalId?: string,
  ) {
    setPasswordPromptText(promptText);
    setPendingAdminAction(action);
    setPendingProfessionalId(professionalId ?? null);
    setAdminPassword("");
    setShowAdminPassword(false);
    setAdminPasswordDialogOpen(true);
  }

  function closeAdminPasswordDialog() {
    setAdminPasswordDialogOpen(false);
    setPendingAdminAction(null);
    setPendingProfessionalId(null);
    setAdminPassword("");
    setShowAdminPassword(false);
  }

  function confirmAdminPassword() {
    if (!ensurePassword(adminPassword)) return;

    if (pendingAdminAction === "save") {
      performSaveProfessional();
    } else if (pendingAdminAction === "delete" && pendingProfessionalId) {
      deleteProfessional(pendingProfessionalId);
    } else if (pendingAdminAction === "modify" && pendingProfessionalId) {
      setViewDialogOpen(false);
      setDetailDialogOpen(false);
      setEditingId(pendingProfessionalId);
      setShowForm(true);
    }

    closeAdminPasswordDialog();
  }

  function openViewDialog(mode: "schedule" | "services") {
    setViewMode(mode);
    setViewDialogOpen(true);
  }

  function openDetailDialog(mode: "schedule" | "services") {
    setViewMode(mode);
    setDetailDialogOpen(true);
  }

  function performSaveProfessional() {
    if (!form.name || !form.specialty) {
      toast.error("Completá nombre y rubro.");
      return;
    }
    const services = (form.services ?? []).filter((service) => service.name.trim() && service.duration > 0 && service.price > 0);
    if (services.length === 0) {
      toast.error("Agregá al menos un servicio válido.");
      return;
    }
    const availableSlots = Array.from(new Set((form.availableSlots ?? []).map((slot) => slot.trim()).filter(Boolean))).sort();
    const nextProfessional: Omit<Professional, "id"> = {
      name: form.name.trim(),
      specialty: form.specialty.trim(),
      address: form.address?.trim() ?? "",
      availableSlots,
      services,
      scheduleDates: form.scheduleDates ?? [],
    };
    if (editingId) {
      professionalStore.update(editingId, nextProfessional);
      toast.success("Profesional actualizado.");
    } else {
      professionalStore.add(nextProfessional);
      toast.success("Profesional agregado.");
    }
    setProfessionals(professionalStore.all());
    setEditingId(null);
    setShowForm(false);
    setForm(defaultFormState);
  }

  function saveProfessional() {
    openAdminPasswordDialog("Ingrese la contraseña admin para guardar profesional", "save");
  }

  function deleteProfessional(id: string) {
    professionalStore.remove(id);
    setProfessionals(professionalStore.all());
    setEditingId(null);
    setShowForm(false);
    toast.success("Profesional eliminado.");
  }

  function requestDeleteProfessional(id: string) {
    openAdminPasswordDialog("Ingrese la contraseña admin para eliminar profesional", "delete", id);
  }

  function updateService(index: number, service: Partial<ProfessionalService>) {
    const services = [...(form.services ?? [])];
    services[index] = { ...services[index], ...service } as ProfessionalService;
    setForm({ ...form, services });
  }

  function updateScheduleDate(index: number, data: Partial<{ date: string; start: string; end: string }>) {
    const scheduleDates = [...(form.scheduleDates ?? [])];
    scheduleDates[index] = { ...scheduleDates[index], ...data };
    setForm({ ...form, scheduleDates });
  }

  function addScheduleDate() {
    setForm({
      ...form,
      scheduleDates: [
        ...(form.scheduleDates ?? []),
        { date: "", start: "09:00", end: "18:00" },
      ],
    });
  }

  function removeScheduleDate(index: number) {
    const scheduleDates = [...(form.scheduleDates ?? [])];
    scheduleDates.splice(index, 1);
    setForm({ ...form, scheduleDates });
  }

  function addServiceRow() {
    setForm({
      ...form,
      services: [
        ...(form.services ?? []),
        { id: crypto.randomUUID(), name: "", duration: 30, price: 0 },
      ],
    });
  }

  function removeServiceRow(index: number) {
    const services = [...(form.services ?? [])];
    services.splice(index, 1);
    setForm({ ...form, services });
  }

  return (
    <div className="min-h-screen bg-gradient-dark">
        <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-gold">Panel</p>
            <h1 className="font-display text-4xl font-semibold">Profesionales</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setEditingId(null);
                setShowForm(true);
                setForm(defaultFormState);
              }}
              className="bg-gold text-primary-foreground hover:bg-gold-soft"
            >
              <Plus className="mr-2 h-4 w-4" /> Nuevo profesional
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          {showForm && (
            <div ref={formRef} className="rounded-3xl border border-border bg-card p-6">
              <div className="mb-6 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Formulario</p>
                  <h2 className="font-display text-2xl font-semibold">
                    {editingId ? "Editar profesional" : "Agregar profesional"}
                  </h2>
                </div>
              </div>
              <div className="grid gap-4">
                <Field label="Nombre del profesional">
                  <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre completo" />
                </Field>
                <Field label="Rubro">
                  <Input value={form.specialty ?? ""} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="Especialidad o rubro" />
                </Field>
                <Field label="Dirección">
                  <Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Dirección donde atiende" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Fechas disponibles">
                    <div className="space-y-3">
                      <Button variant="outline" onClick={() => openViewDialog("schedule")} className="w-full">
                        Ver fechas y horarios
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        {(form.scheduleDates ?? []).length > 0
                          ? `${(form.scheduleDates ?? []).length} fechas guardadas`
                          : "No hay fechas guardadas todavía."}
                      </p>
                    </div>
                  </Field>
                  <Field label="Servicios">
                    <div className="space-y-3">
                      <Button variant="outline" onClick={() => openViewDialog("services")} className="w-full">
                        Ver servicios
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        {(form.services ?? []).length > 0
                          ? `${(form.services ?? []).length} servicios guardados`
                          : "No hay servicios guardados todavía."}
                      </p>
                    </div>
                  </Field>
                </div>
                <div className="flex flex-col gap-3">
                  <Button onClick={saveProfessional} className="w-full bg-gold text-primary-foreground hover:bg-gold-soft">
                    Guardar profesional
                  </Button>
                  {editingId && selectedProfessional?.isTest ? (
                    <Button variant="outline" disabled className="w-full cursor-not-allowed opacity-50 text-muted-foreground">
                      Profesional de prueba
                    </Button>
                  ) : editingId ? (
                    <Button variant="outline" className="w-full text-red-500" onClick={() => requestDeleteProfessional(editingId)}>
                      Eliminar profesional
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setForm(defaultFormState);
                  }} className="w-full">
                    Cancelar
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Dialog open={adminPasswordDialogOpen} onOpenChange={setAdminPasswordDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Contraseña de administrador</DialogTitle>
                <DialogDescription>{passwordPromptText}</DialogDescription>
              </DialogHeader>
              <Field label="Contraseña">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <Input
                    type={showAdminPassword ? "text" : "password"}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    autoFocus
                    placeholder="Ingrese contraseña"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 whitespace-nowrap"
                    onClick={() => setShowAdminPassword((current) => !current)}
                  >
                    {showAdminPassword ? "Ocultar" : "Mostrar"}
                  </Button>
                </div>
              </Field>
              <DialogFooter>
                <Button onClick={confirmAdminPassword} className="bg-gold text-primary-foreground hover:bg-gold-soft">
                  Confirmar
                </Button>
                <Button variant="outline" onClick={closeAdminPasswordDialog}>
                  Cancelar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{viewMode === "schedule" ? "Fechas y horarios" : "Servicios"}</DialogTitle>
                <DialogDescription>
                  {viewMode === "schedule"
                    ? "Revisá las fechas y horarios guardados para este profesional."
                    : "Revisá los servicios que ofrece este profesional."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (viewMode === "schedule") {
                        addScheduleDate();
                      } else {
                        addServiceRow();
                      }
                      setViewDialogOpen(false);
                      openDetailDialog(viewMode);
                    }}
                    className="h-9"
                  >
                    <Plus className="mr-2 h-4 w-4" /> Agregar
                  </Button>
                </div>
                {viewMode === "schedule" ? (
                  (form.scheduleDates ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay fechas guardadas todavía.</p>
                  ) : (
                    (form.scheduleDates ?? []).map((entry, index) => (
                      <div key={`${entry.date}-${index}`} className="rounded-2xl border border-border bg-muted p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">Fecha {index + 1}</div>
                          <Button variant="ghost" size="sm" onClick={() => removeScheduleDate(index)} className="text-red-500">
                            Eliminar
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <p className="text-xs uppercase tracking-widest text-muted-foreground">Fecha</p>
                            <p>{entry.date || "-"}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-widest text-muted-foreground">Desde</p>
                            <p>{entry.start || "-"}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-widest text-muted-foreground">Hasta</p>
                            <p>{entry.end || "-"}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  (form.services ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay servicios guardados todavía.</p>
                  ) : (
                    (form.services ?? []).map((service, index) => (
                      <div key={service.id} className="rounded-2xl border border-border bg-muted p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">{service.name || "Sin nombre"}</div>
                          <Button variant="ghost" size="sm" onClick={() => removeServiceRow(index)} className="text-red-500">
                            Eliminar
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <p className="text-xs uppercase tracking-widest text-muted-foreground">Duración</p>
                            <p>{service.duration} min</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-widest text-muted-foreground">Precio</p>
                            <p>${service.price}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setViewDialogOpen(false);
                    openDetailDialog(viewMode);
                  }}
                  className="bg-gold text-primary-foreground hover:bg-gold-soft"
                >
                  Modificar
                </Button>
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Cerrar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{viewMode === "schedule" ? "Editar fechas y horarios" : "Editar servicios"}</DialogTitle>
                <DialogDescription>
                  {viewMode === "schedule"
                    ? "Modificá la programación disponible para el profesional."
                    : "Modificá la lista de servicios disponibles para el profesional."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {viewMode === "schedule" ? (
                  <div className="space-y-4">
                    {(form.scheduleDates ?? []).map((entry, index) => (
                      <div key={`${entry.date}-${index}`} className="space-y-3 rounded-2xl border border-border bg-muted p-4">
                        <div className="grid gap-2">
                          <Label className="text-xs uppercase tracking-widest text-muted-foreground">Fecha</Label>
                          <Input
                            type="date"
                            value={entry.date}
                            onChange={(e) => updateScheduleDate(index, { date: e.target.value })}
                            className="relative z-10"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[120px_120px_auto]">
                          <div className="grid gap-2">
                            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Desde</Label>
                            <Input
                              type="time"
                              value={entry.start}
                              onChange={(e) => updateScheduleDate(index, { start: e.target.value })}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Hasta</Label>
                            <Input
                              type="time"
                              value={entry.end}
                              onChange={(e) => updateScheduleDate(index, { end: e.target.value })}
                            />
                          </div>
                          <Button variant="outline" size="sm" onClick={() => removeScheduleDate(index)} className="self-end h-9">
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" onClick={addScheduleDate} className="h-9 px-3 text-sm w-full">
                      <Plus className="mr-2 h-4 w-4" /> Agregar fecha
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(form.services ?? []).map((service, index) => (
                      <div key={service.id} className="rounded-2xl border border-border bg-muted p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">Servicio {index + 1}</div>
                          <Button variant="ghost" onClick={() => removeServiceRow(index)} className="text-red-500">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="Nombre">
                            <Input value={service.name} onChange={(e) => updateService(index, { name: e.target.value })} placeholder="Corte clásico" />
                          </Field>
                          <Field label="Duración (min)">
                            <Input type="number" value={service.duration} onChange={(e) => updateService(index, { duration: Number(e.target.value) })} placeholder="30" />
                          </Field>
                          <Field label="Precio">
                            <Input type="number" value={service.price} onChange={(e) => updateService(index, { price: Number(e.target.value) })} placeholder="8000" />
                          </Field>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" onClick={addServiceRow} className="h-9 px-3 text-sm w-full">
                      <Plus className="mr-2 h-4 w-4" /> Agregar servicio
                    </Button>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
                  Cerrar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="rounded-3xl border border-border bg-card p-6">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Lista</p>
                <h2 className="font-display text-2xl font-semibold">Profesionales existentes</h2>
              </div>
              <p className="text-sm text-muted-foreground">Seleccioná un profesional para modificarlo o eliminarlo.</p>
            </div>
            <div className="space-y-4">
              {professionals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay profesionales cargados.</p>
              ) : professionals.map((professional) => (
                <div
                  key={professional.id}
                  className="rounded-2xl border border-border bg-background/80 p-4 hover:border-gold/30"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{professional.name}</span>
                        {professional.isTest && (
                          <span className="rounded-full bg-yellow-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[.2em] text-yellow-700">
                            Prueba
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">{professional.specialty}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {professional.isTest ? (
                        <Button variant="outline" size="sm" disabled className="cursor-not-allowed opacity-50">
                          No se puede modificar
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAdminPasswordDialog(
                            "Ingrese la contraseña admin para modificar profesional",
                            "modify",
                            professional.id,
                          )}
                        >
                          Modificar
                        </Button>
                      )}
                      {professional.isTest ? (
                        <Button variant="outline" size="sm" disabled className="cursor-not-allowed opacity-50">
                          No se puede borrar
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => requestDeleteProfessional(professional.id)}
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Para agregar o modificar un profesional se solicitara una contraseña.</p>
        </div>
      </main>
    </div>
  );
}

function ProfessionalsPage() {
  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <ProfessionalsManager />
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
