import { Button } from "@/components/ui/button";
import logo from "../../logo.png";

type LoadingScreenProps = {
  message?: string;
  error?: string;
  onRetry?: () => void;
};

export function LoadingScreen({
  message = "Estamos preparando todo para vos",
  error,
  onRetry,
}: LoadingScreenProps) {
  return (
    <main className="brand-loader" role="status" aria-live="polite" aria-busy={!error}>
      <div className="brand-loader__glow" aria-hidden="true" />
      <div className="brand-loader__content">
        <div className="brand-loader__mark" aria-hidden="true">
          <span className="brand-loader__orbit brand-loader__orbit--outer" />
          <span className="brand-loader__orbit brand-loader__orbit--inner" />
          <span className="brand-loader__logo-wrap">
            <img className="brand-loader__logo" src={logo} alt="" />
          </span>
        </div>

        <p className="brand-loader__brand">Mi Turno Ya Reservado</p>
        <div className="brand-loader__status">
          <span className="brand-loader__status-text">{error ? "No se pudo cargar" : "Cargando"}</span>
          {!error && <span className="brand-loader__dots" aria-hidden="true"><i /><i /><i /></span>}
        </div>
        <p className="brand-loader__message">{error || message}</p>
        {error && onRetry && (
          <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-soft" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </div>
      <span className="brand-loader__footer">Un buen turno empieza acá</span>
    </main>
  );
}
