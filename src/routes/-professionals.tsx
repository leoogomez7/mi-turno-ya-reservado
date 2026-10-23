import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { format, getDay, startOfToday } from "date-fns";
import { es } from "date-fns/locale";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { professionalStore, type Professional, type ProfessionalService } from "@/lib/professional-store";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { createStore, getAvailableStores, getCurrentStoreCode, isCloudInitialized, updateStoreContact, updateStoreSettings, type StoreSettings } from "@/lib/cloud-sync";
import { LoadingScreen } from "@/components/loading-screen";
import { Calendar } from "@/components/ui/calendar";

const defaultFormState: Partial<Professional> = {
  name: "",
  specialty: "",
  address: "",
  availableSlots: [],
  services: [],
  scheduleDates: [],
  weeklySchedule: [],
};

const WEEKDAYS = [
  { id: 1, label: "Lunes" },
  { id: 2, label: "Martes" },
  { id: 3, label: "Miércoles" },
  { id: 4, label: "Jueves" },
  { id: 5, label: "Viernes" },
  { id: 6, label: "Sábado" },
  { id: 0, label: "Domingo" },
];

const emptyStoreSettings: StoreSettings = {
  address: "",
  street: "",
  height: "",
  city: "",
  province: "",
  postalCode: "",
  whatsapp: "",
  instagram: "",
  transferHolder: "",
  transferBank: "",
  transferCbu: "",
  transferAlias: "",
};
export function ProfessionalsManager() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Professional>>(defaultFormState);
  const [storeName, setStoreName] = useState(() => getAvailableStores().find((store) => store.code === getCurrentStoreCode())?.name ?? "");
  const [storeCode, setStoreCode] = useState(getCurrentStoreCode());
  const [storeDraftLoaded, setStoreDraftLoaded] = useState(isCloudInitialized());
  const [savingStore, setSavingStore] = useState(false);
  const [currentStoreCode, setCurrentStoreCode] = useState(getCurrentStoreCode());
  const [currentStoreName, setCurrentStoreName] = useState(() => getAvailableStores().find((store) => store.code === getCurrentStoreCode())?.name ?? "");
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(emptyStoreSettings);
  const [loadingStoreSettings, setLoadingStoreSettings] = useState(true);
  const [savingContact, setSavingContact] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"schedule" | "services">("schedule");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [servicesListOpen, setServicesListOpen] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [serviceDraft, setServiceDraft] = useState<ProfessionalService>({ id: "", name: "", duration: 30, price: 0 });
  const [scheduleDateDialogOpen, setScheduleDateDialogOpen] = useState(false);
  const [activeScheduleDate, setActiveScheduleDate] = useState<Date | undefined>();
  const [scheduleDateClosed, setScheduleDateClosed] = useState(false);
  const [scheduleDateStart, setScheduleDateStart] = useState("09:00");
  const [scheduleDateEnd, setScheduleDateEnd] = useState("18:00");

  useEffect(() => {
    const load = () => setProfessionals(professionalStore.all());
    load();
    window.addEventListener("professionals:changed", load);
    return () => window.removeEventListener("professionals:changed", load);
  }, []);

  useEffect(() => {
    const updateStore = (cloudReady = false) => {
      const code = getCurrentStoreCode();
      setCurrentStoreCode(code);
      const store = getAvailableStores().find((item) => item.code === code);
      if (store) {
        setCurrentStoreName(store.name);
        setStoreName(store.name);
        setStoreCode(store.code);
        setStoreSettings(store.settings ?? emptyStoreSettings);
        setLoadingStoreSettings(false);
      } else if (cloudReady || isCloudInitialized()) {
        setCurrentStoreName("");
        setStoreName("");
        setStoreCode("");
        setStoreDraftLoaded(true);
        setStoreSettings(emptyStoreSettings);
        setLoadingStoreSettings(false);
      }
      if (store || cloudReady || isCloudInitialized()) setStoreDraftLoaded(true);
    };
    const updateOnStoreChange = () => updateStore(true);
    const updateOnCloudReady = () => updateStore(true);
    updateStore();
    window.addEventListener("mi-turno-ya:store-changed", updateOnStoreChange);
    window.addEventListener("mi-turno-ya:cloud-ready", updateOnCloudReady);
    return () => {
      window.removeEventListener("mi-turno-ya:store-changed", updateOnStoreChange);
      window.removeEventListener("mi-turno-ya:cloud-ready", updateOnCloudReady);
    };
  }, []);

  async function saveSettings() {
    if (!storeSettings.transferHolder.trim()) {
      toast.error("El titular de la cuenta es obligatorio.");
      return;
    }
    if (!storeSettings.transferCbu.trim() && !storeSettings.transferAlias.trim()) {
      toast.error("Completá el CBU o el alias para recibir transferencias.");
      return;
    }
    setSavingSettings(true);
    try {
      const saved = await updateStoreSettings(storeSettings);
      setStoreSettings(saved);
      toast.success("Datos de la sucursal guardados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los datos de la sucursal.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveContact() {
    setSavingContact(true);
    try {
      const saved = await updateStoreContact({
        street: storeSettings.street,
        height: storeSettings.height,
        city: storeSettings.city,
        province: storeSettings.province,
        postalCode: storeSettings.postalCode,
        whatsapp: storeSettings.whatsapp,
        instagram: storeSettings.instagram,
      });
      setStoreSettings(saved);
      toast.success("Datos de contacto guardados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los datos de contacto.");
    } finally {
      setSavingContact(false);
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
        weeklySchedule: selectedProfessional.weeklySchedule ?? [],
      });
    } else {
      setForm(defaultFormState);
    }
  }, [selectedProfessional]);

  function openScheduleDialog() {
    setViewMode("schedule");
    setDetailDialogOpen(true);
  }

  function openViewDialog(mode: "schedule" | "services") {
    setViewMode(mode);
    setViewDialogOpen(true);
  }

  function openDetailDialog(mode: "schedule" | "services") {
    setViewMode(mode);
    setDetailDialogOpen(true);
  }

  function openNewServiceDialog() {
    setEditingServiceId(null);
    setServiceDraft({ id: crypto.randomUUID(), name: "", duration: 30, price: 0 });
    setServiceDialogOpen(true);
  }

  function openEditServiceDialog(service: ProfessionalService) {
    setEditingServiceId(service.id);
    setServiceDraft({ ...service });
    setServiceDialogOpen(true);
  }

  function professionalPayload(source: Partial<Professional>): Omit<Professional, "id"> {
    return {
      name: source.name?.trim() ?? "",
      specialty: source.specialty?.trim() ?? "",
      address: source.address?.trim() ?? "",
      availableSlots: source.availableSlots ?? [],
      services: source.services ?? [],
      scheduleDates: source.scheduleDates ?? [],
      weeklySchedule: source.weeklySchedule ?? [],
    };
  }

  async function saveExistingProfessionalDraft(nextForm: Partial<Professional>, message: string) {
    if (!editingId) return true;
    if (!nextForm.name?.trim() || !nextForm.specialty?.trim()) {
      toast.error("Completá el nombre y el rubro antes de guardar servicios u horarios.");
      return false;
    }
    await professionalStore.update(editingId, professionalPayload(nextForm));
    setProfessionals(professionalStore.all());
    toast.success(message);
    return true;
  }

  async function saveServiceDraft() {
    const name = serviceDraft.name.trim();
    if (!name || serviceDraft.duration <= 0 || serviceDraft.price <= 0) {
      toast.error("Completá el nombre, la duración y un precio mayor a cero.");
      return;
    }
    const nextService = { ...serviceDraft, name };
    const nextForm = {
      ...form,
      services: editingServiceId
        ? (form.services ?? []).map((service) => service.id === editingServiceId ? nextService : service)
        : [...(form.services ?? []), nextService],
    };
    setForm(nextForm);
    try {
      const saved = await saveExistingProfessionalDraft(nextForm, "Servicio guardado en la base de datos.");
      if (!saved) return;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el servicio en la base de datos.");
      return;
    }
    setServiceDialogOpen(false);
  }

  async function removeService(id: string) {
    const nextForm = {
      ...form,
      services: (form.services ?? []).filter((service) => service.id !== id),
    };
    setForm(nextForm);
    try {
      if (editingId) await saveExistingProfessionalDraft(nextForm, "Servicio eliminado y cambios guardados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el servicio.");
    }
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
    const invalidWeeklySchedule = (form.weeklySchedule ?? []).some((entry) => !entry.closed && entry.start >= entry.end);
    const invalidDateSchedule = (form.scheduleDates ?? []).some((entry) => !entry.closed && entry.start >= entry.end);
    if (invalidWeeklySchedule || invalidDateSchedule) {
      toast.error("En cada día abierto, la hora de fin debe ser posterior a la hora de inicio.");
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
      weeklySchedule: form.weeklySchedule ?? [],
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
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el profesional.");
    });
  }

  async function saveStore() {
    setSavingStore(true);
    try {
      const created = await createStore(storeName, storeCode);
      setCurrentStoreCode(created.code);
      setCurrentStoreName(created.name);
      setStoreName(created.name);
      setStoreCode(created.code);
      setProfessionals(professionalStore.all());
      toast.success(`Sucursal ${created.name} guardada con el código ${created.code}.`);
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
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el profesional.");
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

  function setWeeklyDay(dayOfWeek: number, changes: Partial<{ closed: boolean; start: string; end: string }>) {
    const current = form.weeklySchedule ?? [];
    const existing = current.find((entry) => entry.dayOfWeek === dayOfWeek);
    const next = existing
      ? current.map((entry) => entry.dayOfWeek === dayOfWeek ? { ...entry, ...changes } : entry)
      : [...current, { dayOfWeek, closed: true, start: "09:00", end: "18:00", ...changes }];
    setForm({ ...form, weeklySchedule: next });
  }

  function openScheduleDate(date: Date) {
    const dateKey = format(date, "yyyy-MM-dd");
    const override = form.scheduleDates?.find((entry) => entry.date === dateKey);
    const weekly = form.weeklySchedule?.find((entry) => entry.dayOfWeek === getDay(date));
    setActiveScheduleDate(date);
    setScheduleDateClosed(override ? Boolean(override.closed) : weekly ? weekly.closed : true);
    setScheduleDateStart(override?.start || weekly?.start || "09:00");
    setScheduleDateEnd(override?.end || weekly?.end || "18:00");
    setScheduleDateDialogOpen(true);
  }

  async function saveScheduleDate() {
    if (!activeScheduleDate) return;
    if (!scheduleDateClosed && scheduleDateStart >= scheduleDateEnd) {
      toast.error("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    const dateKey = format(activeScheduleDate, "yyyy-MM-dd");
    const nextEntry = {
      date: dateKey,
      start: scheduleDateStart,
      end: scheduleDateEnd,
      closed: scheduleDateClosed,
    };
    const nextForm = {
      ...form,
      scheduleDates: [
        ...(form.scheduleDates ?? []).filter((entry) => entry.date !== dateKey),
        nextEntry,
      ].sort((a, b) => a.date.localeCompare(b.date)),
    };
    setForm(nextForm);
    try {
      const saved = await saveExistingProfessionalDraft(nextForm, "Horario de la fecha guardado en la base de datos.");
      if (!saved) return;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el horario.");
      return;
    }
    setScheduleDateDialogOpen(false);
  }

  async function saveWeeklySchedule() {
    if (!editingId) {
      setDetailDialogOpen(false);
      toast("Los horarios se guardarán junto con el profesional al tocar Guardar profesional.");
      return;
    }
    const hasInvalidHours = (form.weeklySchedule ?? []).some((entry) => !entry.closed && entry.start >= entry.end);
    if (hasInvalidHours) {
      toast.error("En cada día abierto, la hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    try {
      const saved = await saveExistingProfessionalDraft(form, "Horarios semanales guardados en la base de datos.");
      if (!saved) return;
      setDetailDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los horarios.");
    }
  }

  function isDateClosed(date: Date) {
    const dateKey = format(date, "yyyy-MM-dd");
    const override = form.scheduleDates?.find((entry) => entry.date === dateKey);
    if (override) return Boolean(override.closed);
    if (!form.weeklySchedule?.length) return false;
    return form.weeklySchedule.find((entry) => entry.dayOfWeek === getDay(date))?.closed ?? true;
  }

  function isDateCustomSchedule(date: Date) {
    const dateKey = format(date, "yyyy-MM-dd");
    const override = form.scheduleDates?.find((entry) => entry.date === dateKey);
    if (!override || override.closed) return false;
    const weekly = form.weeklySchedule?.find((entry) => entry.dayOfWeek === getDay(date));
    return !weekly || weekly.closed || override.start !== weekly.start || override.end !== weekly.end;
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
            <p className="text-xs uppercase tracking-widest text-gold">Editar</p>
            <h1 className="font-display text-4xl font-semibold">Configuración</h1>
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
                  <p className="mt-2 text-sm text-muted-foreground">Sucursal actual: <strong className="text-gold">{currentStoreName || "Cargando..."}</strong> · Código: <strong className="text-gold">{currentStoreCode || "—"}</strong>. </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
                <Input disabled={!storeDraftLoaded} value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder={storeDraftLoaded ? "Nombre de la sucursal" : "Cargando..."} maxLength={100} />
              <Input disabled={!storeDraftLoaded} value={storeCode} onChange={(event) => setStoreCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder={storeDraftLoaded ? "Código único (ej. BARBER01)" : "Cargando..."} maxLength={20} />
                <Button disabled={!storeDraftLoaded || savingStore || storeName.trim().length < 2 || storeCode.trim().length < 3} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void saveStore()}>
                  {savingStore ? "Guardando…" : "Guardar sucursal"}
              </Button>
            </div>
              <p className="mt-3 text-xs text-muted-foreground">El código debe tener entre 3 y 20 caracteres (letras, números, guion o guion bajo). El código es único, compartilo con tus clientes para que encuentren tu sucursal al reservar.</p>
          </section>

          <section className="rounded-3xl border border-gold/30 bg-card p-6">
            <div className="mb-5">
              <p className="text-xs uppercase tracking-widest text-gold">Contacto</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Dirección de la sucursal</h2>
              <p className="mt-2 text-sm text-muted-foreground">Dirección, WhatsApp e Instagram de la sucursal.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Calle">
                <Input disabled={loadingStoreSettings} value={storeSettings.street} onChange={(event) => setStoreSettings({ ...storeSettings, street: event.target.value })} maxLength={150} placeholder={loadingStoreSettings ? "Cargando..." : "Nombre de la calle"} />
              </Field>
              <Field label="Altura">
                <Input disabled={loadingStoreSettings} value={storeSettings.height} onChange={(event) => setStoreSettings({ ...storeSettings, height: event.target.value })} maxLength={20} placeholder={loadingStoreSettings ? "Cargando..." : "Número"} />
              </Field>
              <Field label="Ciudad">
                <Input disabled={loadingStoreSettings} value={storeSettings.city} onChange={(event) => setStoreSettings({ ...storeSettings, city: event.target.value })} maxLength={100} placeholder={loadingStoreSettings ? "Cargando..." : "Ciudad"} />
              </Field>
              <Field label="Provincia">
                <Input disabled={loadingStoreSettings} value={storeSettings.province} onChange={(event) => setStoreSettings({ ...storeSettings, province: event.target.value })} maxLength={100} placeholder={loadingStoreSettings ? "Cargando..." : "Provincia"} />
              </Field>
              <Field label="Código postal">
                <Input disabled={loadingStoreSettings} value={storeSettings.postalCode} onChange={(event) => setStoreSettings({ ...storeSettings, postalCode: event.target.value })} maxLength={20} placeholder={loadingStoreSettings ? "Cargando..." : "Código postal"} />
              </Field>
              <Field label="WhatsApp">
                <Input type="tel" disabled={loadingStoreSettings} value={storeSettings.whatsapp} onChange={(event) => setStoreSettings({ ...storeSettings, whatsapp: event.target.value })} maxLength={25} placeholder={loadingStoreSettings ? "Cargando..." : "5491112345678"} />
              </Field>
              <Field label="Instagram">
                <Input disabled={loadingStoreSettings} value={storeSettings.instagram} onChange={(event) => setStoreSettings({ ...storeSettings, instagram: event.target.value })} maxLength={100} placeholder={loadingStoreSettings ? "Cargando..." : "@usuario"} />
              </Field>
            </div>
            <Button type="button" disabled={loadingStoreSettings || savingContact || !currentStoreCode} onClick={() => void saveContact()} className="mt-5 bg-gold text-primary-foreground hover:bg-gold-soft">
              {savingContact ? "Guardando…" : "Guardar dirección y contacto"}
            </Button>
          </section>

          <section className="rounded-3xl border border-gold/30 bg-card p-6">
            <div className="mb-5">
              <p className="text-xs uppercase tracking-widest text-gold">Datos de la sucursal</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Datos para transferir</h2>
              <p className="mt-2 text-sm text-muted-foreground">Información bancaria para recibir transferencias.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Titular de la cuenta (obligatorio)">
                <Input required disabled={loadingStoreSettings} value={storeSettings.transferHolder} onChange={(event) => setStoreSettings({ ...storeSettings, transferHolder: event.target.value })} maxLength={200} placeholder={loadingStoreSettings ? "Cargando..." : ""} />
              </Field>
              <Field label="Banco (opcional)">
                <Input disabled={loadingStoreSettings} value={storeSettings.transferBank} onChange={(event) => setStoreSettings({ ...storeSettings, transferBank: event.target.value })} maxLength={200} placeholder={loadingStoreSettings ? "Cargando..." : ""} />
              </Field>
              <Field label="CBU (completá CBU o alias)">
                <Input disabled={loadingStoreSettings} value={storeSettings.transferCbu} onChange={(event) => setStoreSettings({ ...storeSettings, transferCbu: event.target.value })} maxLength={200} placeholder={loadingStoreSettings ? "Cargando..." : ""} />
              </Field>
              <Field label="Alias (completá CBU o alias)">
                <Input disabled={loadingStoreSettings} value={storeSettings.transferAlias} onChange={(event) => setStoreSettings({ ...storeSettings, transferAlias: event.target.value })} maxLength={200} placeholder={loadingStoreSettings ? "Cargando..." : ""} />
              </Field>
            </div>
            <Button type="button" disabled={loadingStoreSettings || savingSettings || !currentStoreCode} onClick={() => void saveSettings()} className="mt-5 bg-gold text-primary-foreground hover:bg-gold-soft">
              {savingSettings ? "Guardando…" : "Guardar datos"}
            </Button>
          </section>

          <Dialog open={showForm} onOpenChange={(open) => {
            setShowForm(open);
            if (!open) {
              setEditingId(null);
              setForm(defaultFormState);
            }
          }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader className="mb-2">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Formulario</p>
                  <DialogTitle className="font-display text-2xl font-semibold">
                    {editingId ? "Editar profesional" : "Agregar profesional"}
                  </DialogTitle>
                </div>
                <DialogDescription>Completá los datos y configurá sus horarios y servicios.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre del profesional">
                    <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre completo" />
                  </Field>
                  <Field label="Rubro">
                    <Input value={form.specialty ?? ""} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="Especialidad o rubro" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Fechas disponibles">
                    <div className="space-y-3">
                      <Button variant="outline" onClick={openScheduleDialog} className="w-full">
                        Configurar calendario y horarios
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        {(form.weeklySchedule ?? []).some((entry) => !entry.closed) || (form.scheduleDates ?? []).some((entry) => !entry.closed)
                          ? "Horarios configurados. Tocá una fecha del calendario para cambiar ese día."
                          : "Configurá los días y horarios de atención."}
                      </p>
                    </div>
                  </Field>
                  <Field label="Servicios">
                  <div className="flex flex-wrap gap-3">
                    <Button type="button" variant="outline" onClick={openNewServiceDialog}>
                      <Plus className="mr-2 h-4 w-4" /> Agregar servicio
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setServicesListOpen(true)}>
                      Ver servicios ({(form.services ?? []).length})
                    </Button>
                  </div>
                  {(form.services ?? []).length === 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">No hay servicios guardados todavía.</p>
                  )}
                  </Field>
                </div>
                <div className="flex flex-col gap-3 pt-2">
                  {!editingId && (
                    <p className="text-center text-xs text-muted-foreground">
                      Los servicios y horarios de un profesional nuevo se guardan al tocar este botón.
                    </p>
                  )}
                  <div className="flex gap-3">
                    <Button onClick={saveProfessional} className="flex-1 bg-gold text-primary-foreground hover:bg-gold-soft">
                      Guardar profesional
                    </Button>
                    <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">
                      Cancelar
                    </Button>
                  </div>
                  {editingId && selectedProfessional?.isTest ? (
                    <Button variant="outline" disabled className="w-full cursor-not-allowed opacity-50 text-muted-foreground">
                      Profesional de prueba
                    </Button>
                  ) : editingId ? (
                    <Button variant="outline" className="w-full border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-300" onClick={() => requestDeleteProfessional(editingId)}>
                      Eliminar profesional
                    </Button>
                  ) : null}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingServiceId ? "Modificar servicio" : "Agregar servicio"}</DialogTitle>
                <DialogDescription>Ingresá el nombre, la duración y el precio del servicio.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Nombre">
                  <Input autoFocus value={serviceDraft.name} onChange={(event) => setServiceDraft({ ...serviceDraft, name: event.target.value })} placeholder="Corte clásico" />
                </Field>
                <Field label="Duración (minutos)">
                  <Input type="number" min="1" value={serviceDraft.duration} onChange={(event) => setServiceDraft({ ...serviceDraft, duration: Number(event.target.value) })} placeholder="30" />
                </Field>
                <Field label="Precio">
                  <Input type="number" min="1" value={serviceDraft.price || ""} onChange={(event) => setServiceDraft({ ...serviceDraft, price: Number(event.target.value) })} placeholder="8000" />
                </Field>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setServiceDialogOpen(false)}>Cancelar</Button>
                <Button type="button" onClick={saveServiceDraft} className="bg-gold text-primary-foreground hover:bg-gold-soft">
                  {editingServiceId ? "Guardar cambios" : "Agregar servicio"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={servicesListOpen} onOpenChange={setServicesListOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Servicios</DialogTitle>
                <DialogDescription>Listado de servicios de este profesional. Podés modificar o eliminar cada uno.</DialogDescription>
              </DialogHeader>
              {(form.services ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No hay servicios guardados todavía.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(form.services ?? []).map((service) => (
                    <div key={service.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-muted p-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{service.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{service.duration} min · ${service.price.toLocaleString("es-AR")}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void removeService(service.id)} className="border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-300">
                          Eliminar
                        </Button>
                        <Button type="button" size="sm" onClick={() => openEditServiceDialog(service)} className="bg-gold text-primary-foreground hover:bg-gold-soft">
                          Modificar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setServicesListOpen(false)}>Cerrar</Button>
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
                          <Button variant="ghost" size="sm" onClick={() => removeScheduleDate(index)} className="text-red-300 hover:bg-red-500/10 hover:text-red-300">
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
                          <Button variant="ghost" size="sm" onClick={() => removeServiceRow(index)} className="text-red-300 hover:bg-red-500/10 hover:text-red-300">
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
            <DialogContent className={viewMode === "schedule" ? "max-h-[90vh] overflow-y-auto sm:max-w-2xl" : "max-h-[90vh] overflow-y-auto"}>
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
                  <div className="space-y-6">
                    <section className="rounded-2xl border border-border bg-background/60 p-4">
                      <h3 className="font-semibold">Horario semanal</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Elegí qué días atendés y definí el horario de cada uno.</p>
                      <div className="mt-4 space-y-3">
                        {WEEKDAYS.map((day) => {
                          const schedule = form.weeklySchedule?.find((entry) => entry.dayOfWeek === day.id);
                          const isClosed = schedule?.closed ?? true;
                          return (
                            <div key={day.id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[110px_110px_150px_150px] sm:items-end">
                              <div className="space-y-1">
                                <span className="block font-medium">{day.label}</span>
                                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <input type="checkbox" checked={!isClosed} onChange={(event) => setWeeklyDay(day.id, { closed: !event.target.checked })} />
                                  Abierto
                                </label>
                              </div>
                              <span />
                              <Field label="Desde">
                                <Input type="time" className="scheme-dark w-full [&::-webkit-calendar-picker-indicator]:invert" disabled={isClosed} value={schedule?.start ?? "09:00"} onChange={(event) => setWeeklyDay(day.id, { start: event.target.value })} />
                              </Field>
                              <Field label="Hasta">
                                <Input type="time" className="scheme-dark w-full [&::-webkit-calendar-picker-indicator]:invert" disabled={isClosed} value={schedule?.end ?? "18:00"} onChange={(event) => setWeeklyDay(day.id, { end: event.target.value })} />
                              </Field>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    <section className="rounded-2xl border border-border bg-background/60 p-4">
                      <h3 className="font-semibold">Excepciones por fecha</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Tocá un día para cambiar su horario o marcarlo como cerrado.</p>
                      <Calendar
                        mode="single"
                        locale={es}
                        selected={undefined}
                        onSelect={(date) => { if (date) openScheduleDate(date); }}
                        disabled={{ before: startOfToday() }}
                        modifiers={{ closedDay: isDateClosed, customHours: isDateCustomSchedule }}
                        modifiersClassNames={{
                          closedDay: "rounded-md bg-muted text-muted-foreground opacity-80",
                          customHours: "rounded-md bg-gold text-primary-foreground font-semibold",
                        }}
                        className="mt-2"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-start gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground" /> Día cerrado
                        <span className="ml-4 h-2 w-2 rounded-full bg-gold" /> Horario distinto
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(form.services ?? []).map((service, index) => (
                      <div key={service.id} className="rounded-2xl border border-border bg-muted p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">Servicio {index + 1}</div>
                          <Button variant="ghost" onClick={() => removeServiceRow(index)} className="text-red-300 hover:bg-red-500/10 hover:text-red-300">
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
                {viewMode === "schedule" ? (
                  <>
                    <Button onClick={() => void saveWeeklySchedule()} className="bg-gold text-primary-foreground hover:bg-gold-soft">
                      Guardar
                    </Button>
                    <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>Cerrar</Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>Cerrar</Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={scheduleDateDialogOpen} onOpenChange={setScheduleDateDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{activeScheduleDate ? format(activeScheduleDate, "EEEE d 'de' MMMM", { locale: es }) : "Horario de la fecha"}</DialogTitle>
                <DialogDescription>Configurá una excepción para este día. Si no cambiás nada, se usa el horario semanal.</DialogDescription>
              </DialogHeader>
              <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                <input type="checkbox" checked={scheduleDateClosed} onChange={(event) => setScheduleDateClosed(event.target.checked)} />
                <span className="font-medium">Este día estará cerrado</span>
              </label>
              {!scheduleDateClosed && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Desde">
                    <Input type="time" className="scheme-dark [&::-webkit-calendar-picker-indicator]:invert" value={scheduleDateStart} onChange={(event) => setScheduleDateStart(event.target.value)} />
                  </Field>
                  <Field label="Hasta">
                    <Input type="time" className="scheme-dark [&::-webkit-calendar-picker-indicator]:invert" value={scheduleDateEnd} onChange={(event) => setScheduleDateEnd(event.target.value)} />
                  </Field>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setScheduleDateDialogOpen(false)}>Cancelar</Button>
                <Button onClick={saveScheduleDate} className="bg-gold text-primary-foreground hover:bg-gold-soft">Guardar fecha</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="rounded-3xl border border-gold/30 bg-card p-6">
            <div className="mb-6">
              <div>
                <p className="text-xs uppercase tracking-widest text-gold">Lista</p>
                <h2 className="font-display text-2xl font-semibold">Profesionales existentes</h2>
                {professionals.length > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">Seleccioná un profesional para modificarlo o eliminarlo.</p>
                )}
              </div>
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
