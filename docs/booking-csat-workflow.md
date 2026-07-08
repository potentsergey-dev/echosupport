# Booking and CSAT Workflow

## Create Specialists

1. Open Admin -> Specialists.
2. Add each bookable person or resource.
3. Keep the specialist active if visitors and operators should be able to book them.
4. Open the clock action on the specialist card and add working hours for each bookable day.

Appointments can only be created inside the selected specialist working hours.

## Create Services

1. Open Admin -> Services.
2. Add a service name and duration.
3. Optionally add a price label and description.
4. Choose a specialist only when the service is exclusive to that specialist. Leave it as any specialist when all active specialists can provide it.

Service duration controls appointment length and conflict checks.

## Appointment Requests

- Visitors book through the chat agent when booking tools are enabled in the conversation flow.
- The agent lists active specialists and services for the tenant, finds available slots, and creates a `PENDING` appointment request after collecting name, phone, specialist, service, and time.
- Operators and admins can also create appointments from Admin -> Appointments.
- New appointments should be reviewed and confirmed by an operator/admin.

## Manage Appointments

Open Admin -> Appointments to:

- filter by status, date, or specialist;
- create a manual appointment;
- confirm a pending appointment;
- cancel an appointment;
- reschedule a pending or confirmed appointment.

Rescheduled appointments return to `PENDING` so the new time can be reviewed.

## CSAT Collection

Visitors can submit CSAT after a support session is resolved or closed. The public API accepts one rating per session and requires the matching agent public key.

Admins can open Admin -> CSAT to see:

- total submitted ratings;
- positive and negative counts;
- CSAT percentage;
- individual comments and ratings.

## Troubleshooting

- No appointment slots appear: check that the specialist is active and has working hours for the requested day.
- Appointment creation fails outside working hours: adjust the specialist working hours or choose a valid slot.
- A service is not available for a specialist: verify the service is active and either assigned to that specialist or set to any specialist.
- CSAT is unavailable: resolve or close the session first.
- CSAT results look empty: ratings only appear after visitors submit the post-resolution form.
