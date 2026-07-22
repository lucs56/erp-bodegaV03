# Despliegue de la prueba V03

Esta versión se publica en un proyecto Cloudflare separado.

- Repositorio: `https://github.com/lucs56/erp-bodegaV03`
- Base D1: `erpcompras`
- `database_id`: `48598a0a-0415-46fd-8918-cfa1d0928a6b`
- Binding: `DB`

## Subir a GitHub

Desde la carpeta descomprimida:

```bash
git init
git add -A
git commit -m "Crear prueba de planificación mensual"
git branch -M main
git remote add origin https://github.com/lucs56/erp-bodegaV03.git
git push -u origin main
```

## Configurar Cloudflare

- Comando de compilación: `npm run build`
- Comando de despliegue: `npx wrangler deploy --config dist/server/wrangler.json`
- Binding D1: `DB`
- Base seleccionada: `erpcompras`

Las tablas se crean automáticamente durante la primera solicitud. El usuario inicial `admin / 1234` se crea en la nueva base vacía mediante la ruta de autenticación existente.
