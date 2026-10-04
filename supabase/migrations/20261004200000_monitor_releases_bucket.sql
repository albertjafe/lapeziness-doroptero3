-- Versiones compiladas del monitor de aulas (Windows) para que cada ordenador
-- se actualice solo. Privado: sólo la función monitor-release (service role)
-- lee y escribe, y sólo para quien presenta un token de monitor válido.
-- Cada versión se guarda en trozos de 2 MB (la red de la escuela corta subidas largas).
insert into storage.buckets (id, name, public, file_size_limit)
values ('monitor-releases', 'monitor-releases', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
