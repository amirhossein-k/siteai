# Seed Script — First Admin Account

## Overview

The seed script (`scripts/seed-admin.js`) creates the first administrator account in MongoDB. This is **required** before you can access the admin panel (`/admin/dashboard`).

**Why is this needed?** The public registration API (`POST /api/register`) always creates users with `role: "customer"`. Only existing admins can create new admin or supplier accounts through the admin panel. The seed script breaks this chicken-and-egg problem.

---

## Usage

### Prerequisites

1. MongoDB must be running and accessible via `MONGODB_URI`
2. `.env.local` must exist with `MONGODB_URI` set

### Run the script

```bash
node scripts/seed-admin.js
```

The script will:
1. Load environment variables from `.env.local`
2. Connect to MongoDB
3. Check if an admin with the specified phone already exists
4. If not, create the admin user
5. Display the credentials

**Safe to run multiple times** — if an admin already exists with the same phone number, the script will skip creation and display the existing admin's details.

---

## Configuration

The admin credentials can be configured through environment variables in `.env.local`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_SEED_PHONE` | `09120000000` | Admin phone number |
| `ADMIN_SEED_PASSWORD` | `admin123456` | Admin password (min 6 chars) |
| `ADMIN_SEED_NAME` | `مدیر سیستم` | Admin display name |

### Example `.env.local` configuration

```env
MONGODB_URI=mongodb://localhost:27017/trackbot

# Optional: Override seed credentials
ADMIN_SEED_PHONE=09123456789
ADMIN_SEED_PASSWORD=mySecurePassword123
ADMIN_SEED_NAME=مدیر ارشد
```

---

## Creating Additional Admins & Suppliers

Once the first admin exists, log in at `/login` and navigate to the **Users** page in the admin panel. From there you can:

1. **Create new admins** — Click "ایجاد کاربر جدید" and select "مدیر"
2. **Create suppliers** — Click "ایجاد کاربر جدید" and select "فروشنده"
3. **Change roles** — Use the role change button (↕ icon)
4. **Activate/deactivate** — Use the toggle button (ban/check icon)
5. **Reset passwords** — Use the key button

---

## Important Notes

- ⚠️ **Change the default password immediately** after first login
- The seed script only creates admin accounts, **not** supplier accounts
- Supplier accounts now have their `Supplier` document **auto-created** when created by an admin (via `POST /api/admin/users`) or when a user's role is changed to supplier (via `PATCH` change-role). The Supplier uses the user's name and phone as defaults.
- The script does **not** modify existing users
- If the connection fails, ensure `MONGODB_URI` is correctly set in `.env.local`
