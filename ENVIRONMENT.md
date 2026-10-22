# Entorno de Mi Turno Ya

Este documento corresponde al proyecto raíz `mi-turno-ya-reservado-main`. No documenta ni configura el subdirectorio `manda-remito-main`.

## Archivos de entorno

- `.env.example`: inventario versionable de las variables que usa esta aplicación. Contiene solo nombres y ejemplos, nunca credenciales reales.
- `.env.local`: valores locales para Vite. Está excluido de Git; crear copiando `.env.example` y completar los valores.
- Vercel → Project → Settings → Environment Variables: configuración de producción, preview y desarrollo. Las variables del servidor se guardan aquí y se aplican con un nuevo despliegue.

El servidor Vite simple no ejecuta los handlers de `api/`; para probar Kinde/Turso localmente se necesita un runtime que sirva funciones Vercel, además de autorizar el origen local como callback/logout URL en Kinde. Si solo se ejecuta Vite, las reservas siguen funcionando en el almacenamiento local del navegador, pero no hay sincronización Turso.

No subir `.env.local` ni compartir valores privados. Los campos con prefijo `VITE_` se incorporan al navegador: usar solo para configuración pública. Nunca poner tokens, secretos ni contraseñas en variables `VITE_`.

## Variables

| Variable | Uso | Dónde se configura |
| --- | --- | --- |
| `VITE_KINDE_DOMAIN` | Dominio público del tenant Kinde para el SDK web | `.env.local` y Vercel |
| `VITE_KINDE_CLIENT_ID` | Client ID público de la aplicación Kinde | `.env.local` y Vercel |
| `VITE_KINDE_ORG_CODE` | Organización Kinde opcional | `.env.local` y Vercel |
| `VITE_KINDE_CONNECTION_ID` | Conexión de email opcional de Kinde | `.env.local` y Vercel |
| `KINDE_ISSUER_URL` | Emisor esperado al verificar tokens en el servidor; debe corresponder al dominio Kinde | Solo servidor / Vercel |
| `KINDE_CLIENT_ID` | Audiencia esperada al verificar tokens; debe coincidir con el Client ID anterior | Solo servidor / Vercel |
| `TURSO_DATABASE_URL` | URL de la base Turso de turnos y profesionales | Solo servidor / Vercel |
| `TURSO_AUTH_TOKEN` | Credencial privada de Turso | Solo servidor / Vercel |
| `ADMIN_INVITE_CODE` | Código privado de bootstrap para crear el primer administrador de la tienda GENERAL | Solo servidor / Vercel |
| Código de tienda / invitación admin | Código público único elegido por tienda y códigos privados de invitación admin de un solo uso | Se guardan en Turso; se crean desde Profesionales y no son variables de entorno |
| `MERCADOPAGO_ACCESS_TOKEN` | Token privado para crear preferencias de pago | Solo servidor / Vercel |
| `PUBLIC_APP_URL` | URL pública usada en los retornos de Mercado Pago | Vercel; opcional local |
| `VITE_TRANSFER_HOLDER` | Titular de la cuenta de transferencia, visible a clientes | `.env.local` y Vercel |
| `VITE_TRANSFER_BANK` | Banco de la transferencia, visible a clientes | `.env.local` y Vercel |
| `VITE_TRANSFER_CBU` | CBU visible a clientes | `.env.local` y Vercel |
| `VITE_TRANSFER_ALIAS` | Alias de transferencia visible a clientes | `.env.local` y Vercel |

## Roles y seguridad

El selector permite elegir cliente o administrador/profesional. `ADMIN_INVITE_CODE` sirve únicamente para crear el primer administrador de GENERAL. Luego, cada administrador crea su tienda desde Profesionales y puede generar invitaciones de un solo uso para sumar administradores a ese local. Así no hace falta saber de antemano cuántos habrá; el backend asocia cada invitación a una tienda y valida el email Kinde verificado. El API verifica firma, emisor y audiencia del token antes de leer o modificar Turso.

Cada administrador registrado crea su tienda desde la sección Profesionales con nombre y código de 3 a 20 caracteres; el código debe ser único. Turso separa profesionales y reservas por tienda. En `/reserva`, cualquier visitante puede buscar por nombre o código y seleccionar la tienda antes de ver la disponibilidad. Las reservas guardan el código seleccionado. Los datos previos se migran a la tienda heredada `GENERAL`.

Para configurar la primera cuenta administradora, generá un código largo y aleatorio, guardalo como `ADMIN_INVITE_CODE` en Vercel y en `.env.local` durante desarrollo, y compartilo de forma privada. Se ingresa en el modal de registro y nunca se incluye en una variable `VITE_`.

Las reservas sin cuenta continúan habilitadas y se guardan localmente en el dispositivo. Los clientes que inician sesión sincronizan y ven los turnos asociados a su email. La agenda y los profesionales son compartidos entre administradores; solo un administrador puede modificar profesionales o todos los turnos.
