# Entorno de Mi Turno Ya

Este documento corresponde al proyecto raíz `mi-turno-ya-reservado-main`. No documenta ni configura el subdirectorio `manda-remito-main`.

## Archivos de entorno

- `.env.example`: inventario versionable de las variables que usa esta aplicación. Contiene solo nombres y ejemplos, nunca credenciales reales.
- `.env.local`: valores locales para Vite. Está excluido de Git; crear copiando `.env.example` y completar los valores.
- Vercel → Project → Settings → Environment Variables: configuración de producción, preview y desarrollo. Las variables del servidor se guardan aquí y se aplican con un nuevo despliegue.

El servidor Vite simple no ejecuta los handlers de `api/`; para probar Kinde/Turso localmente se necesita un runtime que sirva funciones Vercel, además de autorizar el origen local como callback/logout URL en Kinde. La aplicación no guarda reservas ni profesionales en el navegador: si el API o Turso no están disponibles, las operaciones deben fallar y no se guardan localmente.

No subir `.env.local` ni compartir valores privados. Los campos con prefijo `VITE_` se incorporan al navegador: usar solo para configuración pública. Nunca poner tokens, secretos ni contraseñas en variables `VITE_`.

## Variables

| Variable | Uso | Dónde se configura |
| --- | --- | --- |
| `DOMAIN_USER` | Dominio público del tenant Kinde para el SDK web | `.env.local` y Vercel |
| `AUTH_USER` | Client ID público de la aplicación Kinde | `.env.local` y Vercel |
| `ORG_CODE` | Organización Kinde opcional | `.env.local` y Vercel |
| `AUTH_CONNECTION_ID` | Conexión de email opcional de Kinde | `.env.local` y Vercel |
| `KINDE_ISSUER_URL` | Emisor esperado al verificar tokens en el servidor; debe corresponder al dominio Kinde | Solo servidor / Vercel |
| `KINDE_CLIENT_ID` | Audiencia esperada al verificar tokens; debe coincidir con el Client ID anterior | Solo servidor / Vercel |
| `TURSO_DATABASE_URL` | URL de la base Turso de turnos y profesionales | Solo servidor / Vercel |
| `TURSO_AUTH_TOKEN` | Credencial privada de Turso | Solo servidor / Vercel |
| Código de tienda | Código público único generado al registrar una tienda administradora; Turso garantiza su unicidad | Se guarda en Turso y se comparte con clientes |
| `MERCADOPAGO_ACCESS_TOKEN` | Token privado para crear preferencias de pago | Solo servidor / Vercel |
| `PUBLIC_APP_URL` | Dirección base publicada de la aplicación, sin rutas como `/reserva`; Mercado Pago vuelve allí después del pago | Vercel; opcional local |

## Roles y seguridad

El selector permite elegir cliente o administrador/profesional. Cualquier usuario con email verificado en Kinde puede elegir administrador; al hacerlo recibe una tienda propia y un código público único generado por el servidor y guardado en Turso. El primer administrador que se registre puede recibir la tienda heredada `GENERAL`; los siguientes reciben códigos aleatorios nuevos. Cada tienda mantiene sus propios profesionales y reservas, sin acceso administrativo a las demás tiendas. El backend valida la firma, el emisor y la audiencia del token antes de modificar Turso.

Cada administrador registrado crea su tienda desde la sección Profesionales con nombre y código de 3 a 20 caracteres; el código debe ser único. Turso separa profesionales y reservas por tienda. En `/reserva`, cualquier visitante puede buscar por nombre o código y seleccionar la tienda antes de ver la disponibilidad. Las reservas guardan el código seleccionado. Los datos previos se migran a la tienda heredada `GENERAL`.

No existe ni se necesita código de invitación de administrador. El usuario verifica su cuenta en Kinde, selecciona Administrador / Profesional y el sistema crea o asigna su tienda. Comparte con clientes únicamente el código público de tienda que aparece en el panel; no da permisos de administrador.

Las reservas de visitantes se envían al API y se guardan en Turso; no existe persistencia local ni modo offline. Los clientes que inician sesión consultan los turnos asociados a su email. La agenda, los profesionales y los datos de contacto y transferencia de cada tienda se guardan en Turso; solo un administrador puede modificar profesionales, configuración de tienda o todos los turnos.
