import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { professionalStore, type Professional, type ProfessionalService } from "@/lib/professional-store";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { createStore, getAvailableStores, getCurrentStoreCode, updateStoreSettings, type StoreSettings } from "@/lib/cloud-sync";
import { LoadingScreen } from "@/components/loading-screen";

const defaultFormState: Partial<Professional> = {
  name: "",
  specialty: "",
  address: "",
  availableSlots: [],
  services: [],
  scheduleDates: [],
};

const emptyStoreSettings: StoreSettings = {
  address: "",
  whatsapp: "",
  transferHolder: "",
  transferBank: "",
  transferCbu: "",
  transferAlias: "",
};

export function ProfessionalsManager() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const formRef = useRef<HTMLDivElement | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Professional>>(defaultFormState);
  const [storeName, setStoreName] = useState("");
  const [storeCode, setStoreCode] = useState("");
  const [savingStore, setSavingStore] = useState(false);
  const [currentStoreCode, setCurrentStoreCode] = useState(getCurrentStoreCode());
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(emptyStoreSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"schedule" | "services">("schedule");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  useEffect(() => {
    const load = () => setProfessionals(professionalStore.all());
    load();
    window.addEventListener("professionals:changed", load);
    return () => window.removeEventListener("professionals:changed", load);
  }, []);

  useEffect(() => {
    const updateStore = () => {
      const code = getCurrentStoreCode();
      setCurrentStoreCode(code);
      setStoreSettings(getAvailableStores().find((store) => store.code === code)?.settings ?? emptyStoreSettings);
    };
    window.addEventListener("mi-turno-ya:store-changed", updateStore);
    window.addEventListener("mi-turno-ya:cloud-ready", updateStore);
    return () => {
      window.removeEventListener("mi-turno-ya:store-changed", updateStore);
      window.removeEventListener("mi-turno-ya:cloud-ready", updateStore);
    };
  }, []);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const saved = await updateStoreSettings(storeSettings);
      setStoreSettings(saved);
      toast.success("Datos de la sucursal guardados en la base de datos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los datos de la sucursal.");
    } finally {
      setSavingSettings(false);
    }
  }

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

  function openViewDialog(mode: "schedule" | "services") {
    setViewMode(mode);
    setViewDialogOpen(true);
  }

  function openDetailDialog(mode: "schedule" | "services") {
    setViewMode(mode);
    setDetailDialogOpen(true);
  }

  async function performSaveProfessional() {
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
      await professionalStore.update(editingId, nextProfessional);
      toast.success("Profesional actualizado.");
    } else {
      await professionalStore.add(nextProfessional);
      toast.success("Profesional agregado.");
    }
    setProfessionals(professionalStore.all());
    setEditingId(null);
    setShowForm(false);
    setForm(defaultFormState);
  }

  function saveProfessional() {
    void performSaveProfessional().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el profesional en la base de datos.");
    });
  }

  async function saveStore() {
    setSavingStore(true);
    try {
      const created = await createStore(storeName, storeCode);
      setCurrentStoreCode(created.code);
      setStoreName("");
      setStoreCode("");
      setProfessionals(professionalStore.all());
      toast.success(`Sucursal ${created.name} creada con el código ${created.code}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la sucursal.");
    } finally {
      setSavingStore(false);
    }
  }

  async function deleteProfessional(id: string) {
    try {
      await professionalStore.remove(id);
      setProfessionals(professionalStore.all());
      setEditingId(null);
      setShowForm(false);
      toast.success("Profesional eliminado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el profesional de la base de datos.");
    }
  }

  function requestDeleteProfessional(id: string) {
    void deleteProfessional(id);
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

  if (isLoading) return <LoadingScreen message="Preparando tus profesionales" />;
  if (!isAuthenticated || role !== "admin") return <><SiteHeader /><AuthRequired role="admin" title="Profesionales" /></>;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
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
          <section className="rounded-3xl border border-gold/30 bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                  <p className="text-xs uppercase tracking-widest text-gold">Sucursal</p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">Tu sucursal y código de reserva</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Código actual: <strong className="text-gold">{currentStoreCode}</strong>. Los turnos y profesionales quedan separados por sucursal.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
                <Input value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="Nombre de la sucursal" maxLength={100} />
              <Input value={storeCode} onChange={(event) => setStoreCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder="Código único (ej. BARBER01)" maxLength={20} />
              <Button disabled={savingStore || storeName.trim().length < 2 || storeCode.trim().length < 3} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void saveStore()}>
                  {savingStore ? "Guardando…" : "Crear sucursal"}
              </Button>
            </div>
              <p className="mt-3 text-xs text-muted-foreground">El código debe tener entre 3 y 20 caracteres (letras, números, guion o guion bajo) y no puede repetirse. Compartilo con tus clientes para que encuentren tu sucursal al reservar.</p>
          </section>

          <section className="rounded-3xl border border-border bg-card p-6">
            <div className="mb-5">
              <p className="text-xs uppercase tracking-widest text-gold">Datos guardados en Turso</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Contacto y transferencia</h2>
                <p className="mt-2 text-sm text-muted-foreground">Estos datos pertenecen a la sucursal seleccionada y se cargan desde la base de datos.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dirección">
                <Input value={storeSettings.address} onChange={(event) => setStoreSettings({ ...storeSettings, address: event.target.value })} maxLength={200} placeholder="Dirección del local" />
              </Field>
              <Field label="WhatsApp con código de país">
                <Input value={storeSettings.whatsapp} onChange={(event) => setStoreSettings({ ...storeSettings, whatsapp: event.target.value })} maxLength={25} placeholder="5491112345678" />
              </Field>
              <Field label="Titular de la cuenta">
                <Input value={storeSettings.transferHolder} onChange={(event) => setStoreSettings({ ...storeSettings, transferHolder: event.target.value })} maxLength={200} />
              </Field>
              <Field label="Banco">
                <Input value={storeSettings.transferBank} onChange={(event) => setStoreSettings({ ...storeSettings, transferBank: event.target.value })} maxLength={200} />
              </Field>
              <Field label="CBU">
                <Input value={storeSettings.transferCbu} onChange={(event) => setStoreSettings({ ...storeSettings, transferCbu: event.target.value })} maxLength={200} />
              </Field>
              <Field label="Alias">
                <Input value={storeSettings.transferAlias} onChange={(event) => setStoreSettings({ ...storeSettings, transferAlias: event.target.value })} maxLength={200} />
              </Field>
            </div>
            <Button type="button" disabled={savingSettings || !currentStoreCode} onClick={() => void saveSettings()} className="mt-5 bg-gold text-primary-foreground hover:bg-gold-soft">
              {savingSettings ? "Guardando…" : "Guardar datos de la sucursal"}
            </Button>
          </section>

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
                          onClick={() => {
                            setViewDialogOpen(false);
                            setDetailDialogOpen(false);
                            setEditingId(professional.id);
                            setShowForm(true);
                          }}
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
          <p className="text-sm text-muted-foreground">Para agregar o modificar un profesional se solicitara iniciar sesión.</p>
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
