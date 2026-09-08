-- Defensa explícita adicional. Aunque no hay GRANT para clientes y RLS ya
-- deniega por defecto, esta política documenta la intención y mantiene limpio
-- el asesor de seguridad de Supabase.
create policy reservation_monitor_tokens_deny_clients
  on public.reservation_monitor_tokens
  for all
  to anon, authenticated
  using (false)
  with check (false);
