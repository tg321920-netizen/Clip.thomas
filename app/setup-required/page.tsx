export default function SetupRequiredPage() {
  return (
    <main className="min-h-screen bg-[#07080b] px-5 py-12 text-zinc-100">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-amber-400/20 bg-amber-400/[0.04] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">
          ClipForge protegido
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          Falta configurar el acceso del propietario
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300">
          El despliegue hospedado se bloquea de forma segura hasta que existan
          los secretos de acceso en el entorno del servidor. No se muestran ni
          se aceptan secretos desde esta página.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm font-medium text-zinc-200">
            Variables requeridas
          </p>
          <code className="mt-3 block text-sm leading-7 text-zinc-400">
            CLIPFORGE_OWNER_ACCESS_KEY
            <br />
            CLIPFORGE_SESSION_KEY
          </code>
        </div>

        <p className="mt-6 text-xs leading-5 text-zinc-500">
          Después de configurarlas en el entorno de producción y volver a
          desplegar, ClipForge mostrará la pantalla de acceso del propietario.
        </p>
      </div>
    </main>
  );
}
