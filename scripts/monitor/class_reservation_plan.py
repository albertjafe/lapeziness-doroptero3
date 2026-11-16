"""Pure planning for a whole class in one room; no I/O or booking side effects."""
from datetime import timedelta


def full_class_plans(start, end, desired_start, desired_end, own, rooms, now,
                     slot_allowed, max_minutes, room_group):
    """Rank complete-class plans ahead of fragmented coverage.

    Only reservations overlapping the mandatory class may be replaced. Their
    time outside class is optional, so it cannot veto a complete-class move.
    slot_allowed(room, start, end, released) supplies live availability rules.
    Quota is checked by the caller against the same released reservations.
    """
    managed = {m['event_id'] for m in own if m['ini'] < end and m['fin'] > start}
    starts, ends = {start}, {end}
    t = desired_start
    while t < start:
        starts.add(t)
        t += timedelta(minutes=15)
    t = end + timedelta(minutes=15)
    while t <= desired_end:
        ends.add(t)
        t += timedelta(minutes=15)
    for m in own:
        if m['event_id'] in managed:
            if m['ini'] <= start:
                starts.add(m['ini'])
            if m['fin'] >= end:
                ends.add(m['fin'])
    plans = []
    for order, room in enumerate(rooms):
        for a in sorted(starts):
            for b in sorted(ends):
                if (b - a).total_seconds() > max_minutes * 60:
                    continue
                released = [m for m in own if m['ini'] < b and m['fin'] > a]
                if any(m['event_id'] not in managed for m in released):
                    continue  # margins must not displace unrelated bookings
                same = released[0] if len(released) == 1 and released[0]['aula'] == room else None
                # Never move a started booking or create a booking in the past.
                if any(m['ini'] <= now and (m is not same or a != m['ini'] or b < m['fin']) for m in released):
                    continue
                if a <= now and not (same and a == same['ini']):
                    continue
                if not slot_allowed(room, a, b, released):
                    continue
                margin = (min(b, desired_end) - max(a, desired_start)).total_seconds()
                kept = sum(max(0, (min(b, m['fin']) - max(a, m['ini'])).total_seconds()) for m in released)
                unchanged = bool(same and a == same['ini'] and b == same['fin'])
                # Margins first, then preserve existing time, prefer stability,
                # then room quality. Do not switch equal rooms every scan.
                score = (margin, kept, unchanged, same is not None, room_group(room) == 5, -order)
                plans.append({'aula': room, 'ini': a, 'fin': b, 'liberadas': released,
                              'ampliar': same, 'unchanged': unchanged, 'score': score})
    return sorted(plans, key=lambda p: p['score'], reverse=True)
