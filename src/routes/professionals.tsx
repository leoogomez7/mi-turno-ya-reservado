import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { professionalStore, type Professional, type ProfessionalService } from "@/lib/professional-store";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? "";

export const Route = createFileRoute("/professionals")({
  head: () => ({ meta: [{ title: "Profesionales" }] }),
  component: ProfessionalsPage,
});

export function ProfessionalsManager() {
  const defaultFormState: Partial<Professional> = {
    name: "",
    specialty: "",
    availableSlots: [],
    services: [],
  };

  const formRef = useRef<HTMLDivElement | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Professional>>(defaultFormState);

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
        availableSlots: selectedProfessional.availableSlots,
        services: selectedProfessional.services,
      });
    } else {
      setForm(defaultFormState);
    }
  }, [selectedProfessional]);

  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm]);

  function ensurePassword(passwordToCheck: string): boolean {
    if (passwordToCheck !== ADMIN_PASSWORD) {
      toast.error("Contraseña incorrecta.");
      return false;
    }
    return true;
  }

  function requestAdminPassword(promptText: string): boolean {
    const enteredPassword = window.prompt(promptText);
    if (enteredPassword === null) return false;
    return ensurePassword(enteredPassword);
  }

  function saveProfessional() {
    if (!requestAdminPassword("Ingrese la contraseña admin para guardar profesional")) return;
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
      availableSlots,
      services,
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

  function deleteProfessional(id: string) {
    professionalStore.remove(id);
    setProfessionals(professionalStore.all());
    setEditingId(null);
    setShowForm(false);
    toast.success("Profesional eliminado.");
  }

  function requestDeleteProfessional(id: string) {
    if (!requestAdminPassword("Ingrese la contraseña admin para eliminar profesional")) return;
    deleteProfessional(id);
  }

  function updateService(index: number, service: Partial<ProfessionalService>) {
    const services = [...(form.services ?? [])];
    services[index] = { ...services[index], ...service } as ProfessionalService;
    setForm({ ...form, services });
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
            {showForm && (
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setForm(defaultFormState);
                }}
              >
                Cancelar
              </Button>
            )}
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
                <Field label="Horarios disponibles">
                  <Textarea
                    rows={3}
                    value={(form.availableSlots ?? []).join("\n")}
                    onChange={(e) => setForm({ ...form, availableSlots: e.target.value.split(/[\,\n]+/).map((slot) => slot.trim()).filter(Boolean) })}
                    placeholder="09:00\n09:30\n10:00"
                  />
                </Field>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Servicios</p>
                  <Button variant="outline" onClick={addServiceRow} className="h-9 px-3 text-sm">
                    <Plus className="mr-2 h-4 w-4" /> Agregar servicio
                  </Button>
                </div>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button onClick={saveProfessional} className="bg-gold text-primary-foreground hover:bg-gold-soft">
                    Guardar profesional
                  </Button>
                  {editingId && (
                    <Button variant="outline" className="text-red-500" onClick={() => requestDeleteProfessional(editingId)}>
                      Eliminar profesional
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

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
                      <div className="font-medium">{professional.name}</div>
                      <div className="text-sm text-muted-foreground">{professional.specialty}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!requestAdminPassword("Ingrese la contraseña admin para modificar profesional")) return;
                          setEditingId(professional.id);
                          setShowForm(true);
                        }}
                      >
                        Modificar
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => requestDeleteProfessional(professional.id)}
                      >
                        Eliminar
                      </Button>
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
