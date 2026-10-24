# Entorno de Mi Turno Ya

Este documento corresponde al proyecto raíz `mi-turno-ya-reservado-main`. No documenta ni configura el subdirectorio `manda-remito-main`.

## Archivos de entorno

- `.env.example`: inventario versionable de las variables que usa esta aplicación. Contiene solo nombres y ejemplos, nunca credenciales reales.
- `.env.local` (o `.env` para local): valores locales para Vite. Está excluido de Git; crear copiando `.env.example` y completar los valores.
- Vercel → Project → Settings → Environment Variables: configuración de producción, preview y desarrollo. Las variables del servidor se guardan aquí y se aplican con un nuevo despliegue.

El servidor Vite simple no ejecuta los handlers de `api/`; para probar Kinde/Turso localmente se necesita un runtime que sirva funciones Vercel, además de autorizar el origen local como callback/logout URL en Kinde. La aplicación no guarda reservas ni profesionales en el navegador: si el API o Turso no están disponibles, las operaciones deben fallar y no se guardan localmente.

No subir `.env.local` ni compartir valores privados. Para Vite, los campos públicos deben empezar con `VITE_` para que lleguen al navegador. Nunca poner tokens, secretos ni contraseñas en variables `VITE_`.

## Variables

| Variable                     | Uso                                                                                                                   | Dónde se configura                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `VITE_DOMAIN_USER`         | Dominio público del tenant Kinde para el SDK web                                                                     | `.env.local` y Vercel                            |
| `VITE_AUTH_USER`           | Client ID público de la aplicación Kinde                                                                            | `.env.local` y Vercel                            |
| `VITE_ORG_CODE`            | Organización Kinde opcional                                                                                          | `.env.local` y Vercel                            |
| `VITE_AUTH_CONNECTION_ID`  | Conexión de email opcional de Kinde                                                                                  | `.env.local` y Vercel                            |
| `KINDE_ISSUER_URL`         | Emisor esperado al verificar tokens en el servidor; debe corresponder al dominio Kinde                                | Solo servidor / Vercel                             |
| `KINDE_CLIENT_ID`          | Audiencia esperada al verificar tokens; debe coincidir con el Client ID anterior                                      | Solo servidor / Vercel                             |
| `TURSO_DATABASE_URL`       | URL de la base Turso de turnos y profesionales                                                                        | Solo servidor / Vercel                             |
| `TURSO_AUTH_TOKEN`         | Credencial privada de Turso                                                                                           | Solo servidor / Vercel                             |
| Código de sucursal          | Código público único generado al registrar una sucursal administradora; Turso garantiza su unicidad                | Se guarda en Turso y se comparte con clientes      |
| `MERCADOPAGO_ACCESS_TOKEN` | Token privado para crear preferencias de pago                                                                         | Solo servidor / Vercel                             |
| `DESCUENTO_OFF`            | Uno o más códigos promocionales separados por coma (por ejemplo `GRATIS2026,DESCUENTO_OFF`); los códigos configurados otorgan 100% de descuento al plan seleccionado | Solo servidor / Vercel; definir el valor en Vercel |
| `PUBLIC_APP_URL`           | Dirección base publicada de la aplicación, sin rutas como `/reserva`; Mercado Pago vuelve allí después del pago | Vercel; opcional local                             |

## Roles y seguridad

El selector permite elegir cliente o administrador/profesional. Cualquier usuario con email verificado en Kinde puede elegir administrador; al hacerlo recibe una sucursal propia y un código público único generado por el servidor y guardado en Turso. El primer administrador que se registre puede recibir la sucursal heredada `GENERAL`; los siguientes reciben códigos aleatorios nuevos. Cada sucursal mantiene sus propios profesionales y reservas, sin acceso administrativo a las demás sucursales. El backend valida la firma, el emisor y la audiencia del token antes de modificar Turso.

Cada administrador registrado crea su sucursal desde la sección Profesionales con nombre y código de 3 a 20 caracteres; el código debe ser único. Turso separa profesionales y reservas por sucursal. En `/reserva`, cualquier visitante puede buscar por nombre o código y seleccionar la sucursal antes de ver la disponibilidad. Las reservas guardan el código seleccionado. Los datos previos se migran a la sucursal heredada `GENERAL`.

No existe ni se necesita código de invitación de administrador. El usuario verifica su cuenta en Kinde, selecciona Administrador / Profesional y el sistema crea o asigna su sucursal. Comparte con clientes únicamente el código público de sucursal que aparece en el panel; no da permisos de administrador.

Las reservas de visitantes se envían al API y se guardan en Turso; no existe persistencia local ni modo offline. Los clientes que inician sesión consultan los turnos asociados a su email. La agenda, los profesionales y los datos de contacto y transferencia de cada sucursal se guardan en Turso; solo un administrador puede modificar profesionales, configuración de sucursal o todos los turnos.

## Planes de suscripción

Al crear/activar su cuenta de administrador, la sucursal recibe automáticamente una prueba gratuita de 4 días, que solo se otorga una vez. Después puede contratar manualmente: 15 días por $5.999, 1 mes por $9.999, 2 por $14.999, 3 por $19.999, 4 por $25.999 y 6 por $36.999 ARS. No hay renovación ni cobros automáticos. Si compra antes de expirar, el nuevo período se suma a la fecha de vencimiento vigente (incluida la prueba gratis); si ya venció, empieza al aprobar el nuevo pago. El panel avisa cuando faltan tres días y, al vencer, informa que la sucursal ya no aparece en búsquedas ni recibe reservas. La activación del pago se confirma consultando Mercado Pago y también mediante su webhook; el retorno del navegador por sí solo no activa el plan. `DESCUENTO_OFF` se configura como secreto de servidor y acepta el código único o la lista de códigos separados por coma que se establezcan allí; cada uno otorga 100% de descuento al plan elegido.
