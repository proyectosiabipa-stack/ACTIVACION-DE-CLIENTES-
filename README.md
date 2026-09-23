# BIPA - Activación de Clientes

Portal automático de gestión de cartera comercial.

## 🚀 Automatización

El portal se actualiza automáticamente:
- ✅ Cada 6 horas (schedule)
- ✅ Cuando cambias \data/ACTIVACION DE CLIENTES .xlsx\
- ✅ Manualmente desde Actions

## 📋 Estructura

\\\
data/
  └── ACTIVACION DE CLIENTES .xlsx    (Fuente de datos)
portal/
  ├── index.html                       (Interfaz)
  ├── app.js                          (Lógica)
  └── data.js                         (Auto-generado)
scripts/
  ├── procesar_datos.py               (Lee Excel → JSON)
  └── generar_portal.py               (Actualiza data.js)
.github/workflows/
  └── actualizar-portal.yml           (GitHub Actions)
\\\

## 🔄 Flujo

1. Edita \data/ACTIVACION DE CLIENTES .xlsx\
2. Commit a GitHub
3. Workflow automático:
   - procesar_datos.py → data.json
   - generar_portal.py → data.js
   - Auto-commit
4. Portal actualizado en vivo

## 📊 Portal

- Dashboard: KPIs y panorama ejecutivo
- Filtros: Vendedor, zona, tipo cliente
- Envío: Mensajes a vendedores
- Artículos: Análisis de productos

## 🔗 Links

- Portal: https://proyectosiabipa-stack.github.io/ACTIVACION-DE-CLIENTES-/
- Repo: https://github.com/proyectosiabipa-stack/ACTIVACION-DE-CLIENTES-