# Using the attendance system

Everyone gets an account from somebody else. The only exception is the very
first one, which the deployment hands out to itself.

There is the same guide inside the app, under **Guide** in the sidebar, showing
only the steps for whoever is signed in. This page is the version you can print
and hand round before anyone has logged in. The illustrated user manual, with a
screenshot of every screen, is on the site at `/user-manual.pdf`, and the
introduction page at `/welcome` explains the app to someone who has never seen
it. **Guide** shows a QR code for that page and prints it as a poster.

---

## The first five minutes of a new deployment

Open the site. Because no account exists yet, it does not ask you to sign in —
it asks you to create the administrator.

1. **Fill in a name, a login ID and a password.** The login ID is what you type
   to sign in; `admin` is fine.
2. **Press Create administrator.** You are signed in immediately.
3. **Create a second administrator** from **Accounts**, and give it to someone
   else in the office.

That third step matters more than it looks. The setup screen never comes back —
the moment an account exists, that page is gone for good. If you are the only
administrator and you lose your password, there is nobody left who can reset it,
and the only way back in is a database connection string.

---

## Administrator

You run the accounts. You do not teach, and you do not build timetables.

| Step | Where | Why |
|---|---|---|
| Create the HOD account | Accounts | One per department. They build everything else. |
| Hand over the login ID and password in person | — | Nothing is emailed. Read it out or write it down. |
| Ask them to change it from Profile | — | You have seen and said their password out loud. |
| Create a second administrator | Accounts | So one lost password is not the end. |
| Reset passwords when people are locked out | Accounts | Six wrong attempts locks an account; a reset clears it. |
| Print the QR poster | Guide | Anyone who scans it lands on the introduction page. |

You can also create teachers and mentors. You cannot create students: a student
has to be placed in a course and a section, which is the HOD's job and has a
bulk CSV import built for it.

## HOD

You build the department. Nothing works until this is done, and the steps depend
on each other — the Overview page tracks how far along you are.

1. **Add a course.** Everything else hangs off it.
2. **Add sections** (CSE-A, CSE-B) **and subjects.**
3. **Create teacher accounts.**
4. **Allocate a class teacher to each section.** Leave requests route to them;
   without one, only you see them.
5. **Set the week, then fill each section's timetable.** On **Schedule**, tap
   **Timings** to say how many days the course teaches (Monday to Friday, say),
   how many periods a day, the time of each period, the break, and what
   happens after classes. Then tap any period, empty or not, to give it a
   subject and a teacher. Nobody can mark a register until the grid exists. A
   printed routine can be loaded in one go by whoever runs the deployment
   (`npm run timetable:import`).
6. **Set the minimum attendance percentage.** Without it, everything falls back
   to 75%.
7. **Add students,** one at a time or by pasting a CSV.

After that, the job is deciding leave and watching **Records** for anyone
drifting below the minimum while there is still time to fix it.

**Cancelling classes.** For a holiday, a strike or a fest, tap **Cancel
classes** on the Overview or on Schedule, pick the date and, if it is not the
whole college, the section or the periods. One tap cancels them all, and every
student and teacher affected is told. A cancelled class cannot be marked and
counts for nobody. If plans change, **Undo** straight after, or **restore** in
the list of cancelled classes, puts every class back. An event open to all
students has the same button on the event itself, for the periods it covers.

## Teacher

1. **Open Attendance.** Your periods for today are already listed, and everyone
   starts marked present — you tap the absentees. Saving the register is what
   records the class as held for every student in the section.
2. **Corrections within 48 hours** are yours. After that the HOD makes them, and
   the change is recorded against their name with a reason.
3. **Decide leave** for the section you are class teacher of. Approving writes
   leave across every period of that day.
4. **Export a register** as CSV when someone needs proof.
5. **Cancel your own classes** in one tap from the Overview when you know in
   advance you cannot take them. Your students are told, and **Undo** or
   **restore** brings the classes back.

## Student

1. **Check where you stand** on Analytics. The ring is your percentage against
   the minimum for your course. At 90% or above you earn the attendance badge;
   below it, the Overview tells you how many classes in a row would earn it.
2. **Apply for leave** on the Leave desk, attaching a medical certificate. The
   certificate is never a public link — only your class teacher and the HOD can
   open it, and the system records who did.
3. **Join events** that credit attendance. A club event during a period can
   cover that absence. Events shows which of your periods each event credited,
   and says why if one could not be.
4. **Change the password you were given.** Whoever created your account knows
   what it currently is.

The calculator tells you how many classes it takes to reach the minimum. It will
not tell you how many you can afford to skip.

## Mentor

1. **Create your club.** Members are added by login ID, so ask students for
   theirs.
2. **Post events.** Members-only events are visible only to the people you
   added.
3. **Set a credit period** when the event replaces a class. That is what turns
   an absence into a credited attendance.
4. **Give students their attendance.** Approve their join requests, or tap
   **Add attendance** and paste the login IDs of everyone who took part. Their
   periods are credited at once and their teachers are told.
5. **If everyone is going,** ask the HOD to cancel the classes the event
   replaces. They can do it from the event itself.

---

## How attendance is counted

A class counts once its register is taken. From then on it counts for every
student in the section, marked or not:

```
percentage = present / (present + absent + not marked)
```

- **Not marked** is a class held for your section with no mark for you. It
  counts against you, because the class happened.
- **Approved leave** leaves the sum entirely, so an approved absence never
  lowers anyone's percentage.
- **A cancelled class** was never held, so it appears nowhere.
- **An event credit** counts as present for the period it covered.

---

## Passwords and lockouts

There is no reset-by-email anywhere in this system. That is deliberate: it would
need a mail service and a deliverability problem, and a college hands out
credentials in person anyway.

So the rule is simply **whoever created your account can reset it**:

| If you are a | Ask |
|---|---|
| Student | Your class teacher, or the HOD |
| Teacher, mentor or HOD | An administrator |
| Administrator | Another administrator |

Repeated wrong passwords lock an account for a few minutes. A password reset
clears the lock immediately, so a locked-out student does not have to wait.

Everyone is notified when their own password is changed by someone else. If you
get that notification and were not expecting it, say so.

### If every administrator is locked out

The setup page does not come back — it only ever appears while there are no
accounts at all. So if every administrator password is lost, somebody with the
database connection string has to make a new one:

```bash
DATABASE_URL="<the pooled connection string>" node scripts/create-account.mjs admin "Name" login-id
```

It asks for the password on stdin, so it does not end up in your shell history.
This is the only reason that script exists; keeping a second administrator means
never needing it.

---

## Who can see what

Roles are enforced on the server on every single request, not just hidden in the
sidebar.

| Role | Can see |
|---|---|
| Administrator | Everything, including records and leave documents |
| HOD | The whole department, all records, all leave |
| Teacher | Their own classes; leave for the section they are class teacher of |
| Student | Only themselves |
| Mentor | Their clubs and events; no attendance records |

Medical certificates are the tightest thing in here. They are stored privately,
fetched only through an authorised request, and every single view is written to
the audit trail with the name of whoever opened it.
