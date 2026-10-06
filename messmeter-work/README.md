# MessMeter v2

MessMeter is a hostel mess demand, meal-ticket and food-waste management PWA for Shivalik University.

## What this version adds
- Meal-specific booking windows: breakfast previous evening, lunch in the morning, dinner in the afternoon.
- Server-enforced booking cutoffs. The cutoff cannot be bypassed from the UI.
- One QR meal ticket per student per meal.
- Cancellation/skip before the deadline.
- Ticket status: valid, used, expired, cancelled.
- Manager QR serving scanner with one-time server verification.
- Cooking recommendation based primarily on confirmed tickets, with a configurable 5% safety buffer and half-plate adjustment.
- Student meal ticket wallet.
- Post-service food feedback.
- Waste logging for plate, preparation and spoiled food.
- Safe unserved surplus workflow separated from plate waste.
- Compost batch tracking with farm-use and sales/revenue fields.
- Manager dashboard for demand and waste.

## Important food-safety rule
Only **safe, unserved surplus** should be offered to a verified food-rescue partner. Food that has already been served to a student's plate is post-consumer waste and should not be redistributed. Record it as plate waste for compost/appropriate disposal.

## Setup after updating an existing MessMeter project
1. Keep your existing `.env` files.
2. In Supabase SQL Editor, run `database/migration_v2.sql` once.
3. In the frontend folder run:
   `npm install`
4. Then run:
   `npm run frontend`
   and in another terminal:
   `npm run backend`

The frontend now uses `qrcode` to render tickets and `html5-qrcode` for the manager camera scanner. These packages are already listed in `frontend/package.json`.

## Creating a manager for testing
After creating/approving a test account, use Supabase SQL Editor with that user's UUID:

```sql
insert into public.user_roles(user_id, role)
values ('YOUR_USER_UUID', 'mess_manager')
on conflict do nothing;

update public.profiles
set status = 'approved'
where id = 'YOUR_USER_UUID';
```

Never paste your Supabase service-role/secret key into chat or frontend code. If it was exposed, rotate it in Supabase.
