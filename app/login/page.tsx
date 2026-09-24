type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const invalid = params?.error === "1";

  return (
    <main className="min-h-screen bg-[#07080b] px-5 py-12 text-zinc-100">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">
          ClipForge
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Acceso del propietario</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Este despliegue está protegido. Ingresa la clave de acceso configurada
          en el servidor para abrir ClipForge.
        </p>

        <form action="/api/auth/owner/login" method="post" className="mt-7 space-y-4">
          <label className="block text-sm text-zinc-300" htmlFor="accessKey">
            Clave de acceso
          </label>
          <input
            id="accessKey"
            name="accessKey"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400/60"
          />

          {invalid ? (
            <p className="rounded-xl border border-red-400/20 bg-red-400/[0.05] px-3 py-2 text-sm text-red-300">
              La clave no es válida.
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            Entrar
          </button>
        </form>

        <p className="mt-6 text-xs leading-5 text-zinc-600">
          La clave nunca se guarda en el navegador. La sesión utiliza una cookie
          HttpOnly firmada por el servidor.
        </p>
      </div>
    </main>
  );
}
