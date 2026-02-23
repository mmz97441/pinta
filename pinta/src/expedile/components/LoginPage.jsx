import React from 'react';
import { ChevronRight, Shield, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STAFF, BRAND, getDestByCP } from '../constants';

export default function LoginPage() {
  const { auth, setAuth, clients, data } = useApp();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{
        background: `linear-gradient(160deg, ${BRAND.navy} 0%, ${BRAND.navyD} 100%)`,
      }}
    >
      {/* ── Logo ── */}
      <div className="anim-fade mb-2 flex flex-col items-center select-none">
        <div className="flex items-baseline gap-0 leading-none">
          <span
            className="text-5xl font-black text-white"
            style={{ letterSpacing: '-0.03em' }}
          >
            EXPÉD
          </span>
          <span
            className="text-5xl font-black"
            style={{ color: BRAND.gold, letterSpacing: '-0.03em' }}
          >
            ÎLE
          </span>
        </div>
        <p
          className="mt-2 text-sm font-semibold uppercase"
          style={{ color: BRAND.gold, letterSpacing: '0.18em' }}
        >
          Paris → Réunion · Mayotte · Antilles
        </p>
      </div>

      {/* ── Card ── */}
      <div
        className="anim-fade-up mt-8 w-full max-w-sm md:max-w-2xl lg:max-w-3xl rounded-2xl p-5 md:p-8 glass"
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
        }}
      >
        <div className="md:grid md:grid-cols-2 md:gap-6">
        {/* ─── Équipe section ─── */}
        <div className="mb-5 md:mb-0">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={15} style={{ color: BRAND.gold }} strokeWidth={2.5} />
            <span
              className="text-xs font-bold uppercase"
              style={{ color: BRAND.goldL, letterSpacing: '0.15em' }}
            >
              Équipe
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {STAFF.map((user, idx) => (
              <button
                key={user.id}
                onClick={() => setAuth({ type: 'staff', u: user })}
                className={`anim-fade stagger-${idx + 1} group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-left transition-all duration-150`}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `rgba(232,184,75,0.12)`;
                  e.currentTarget.style.borderColor = `rgba(232,184,75,0.30)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                }}
              >
                {/* Avatar */}
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-black"
                  style={{
                    background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldD})`,
                    color: BRAND.navyD,
                  }}
                >
                  {user.nom.charAt(0).toUpperCase()}
                </div>

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white leading-tight truncate">
                    {user.nom}
                  </div>
                  <div
                    className="text-xs leading-tight mt-0.5 truncate"
                    style={{ color: BRAND.goldL }}
                  >
                    {user.role}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight
                  size={16}
                  className="flex-shrink-0 opacity-40 group-hover:opacity-80 transition-opacity"
                  style={{ color: BRAND.gold }}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Separator (mobile only) */}
        <div
          className="my-4 md:hidden"
          style={{ height: '1px', background: 'rgba(255,255,255,0.08)' }}
        />

        {/* ─── Clients section ─── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <User size={15} style={{ color: BRAND.gold }} strokeWidth={2.5} />
            <span
              className="text-xs font-bold uppercase"
              style={{ color: BRAND.goldL, letterSpacing: '0.15em' }}
            >
              Clients
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {clients.map((c, idx) => {
              const dest = getDestByCP(c.cp);
              const colisCount = data.filter((p) => p.clientId === c.id).length;
              const staggerClass = `stagger-${Math.min(idx + 1, 8)}`;

              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setAuth({ type: 'client', u: { id: c.id, nom: c.nom }, cl: c })
                  }
                  className={`anim-fade ${staggerClass} group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-left transition-all duration-150`}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.11)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-black"
                    style={{
                      background: `linear-gradient(135deg, ${BRAND.navyL}, ${BRAND.navy})`,
                      color: BRAND.goldL,
                      border: `1.5px solid rgba(232,184,75,0.25)`,
                    }}
                  >
                    {c.nom.charAt(0).toUpperCase()}
                  </div>

                  {/* Name + destination */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white leading-tight truncate">
                      {c.nom}
                    </div>
                    <div
                      className="text-xs leading-tight mt-0.5 flex items-center gap-1 truncate"
                      style={{ color: 'rgba(255,255,255,0.55)' }}
                    >
                      <span>{dest.flag}</span>
                      <span className="truncate">{dest.label}</span>
                      {colisCount > 0 && (
                        <>
                          <span className="opacity-40">·</span>
                          <span
                            className="font-semibold"
                            style={{ color: BRAND.goldL }}
                          >
                            {colisCount} colis
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight
                    size={16}
                    className="flex-shrink-0 opacity-40 group-hover:opacity-80 transition-opacity"
                    style={{ color: 'rgba(255,255,255,0.6)' }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        </div>{/* end md:grid */}
      </div>

      {/* ── Footer ── */}
      <p
        className="anim-fade mt-6 text-xs"
        style={{ color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em' }}
      >
        MVP Demo · v2.0
      </p>
    </div>
  );
}
