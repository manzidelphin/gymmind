import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user:  process.env.GMAIL_USER,
    pass:  process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendWelcomeEmail(params: {
  to: string;
  gymName: string;
  gymSlug: string;
  ownerName: string;
}): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[EMAIL] To: ${params.to}`);
    console.log(`[EMAIL] Welcome to GymMind — ${params.gymName}`);
    return;
  }

  await transporter.sendMail({
    from:    '"GymMind" <noreply@gymmind.rw>',
    to:      params.to,
    subject: `Welcome to GymMind — ${params.gymName} is live!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0F6E56; padding: 32px; text-align: center;">
          <h1 style="color: white; margin: 0;">GymMind</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">
            Gym management for Rwanda &amp; East Africa
          </p>
        </div>

        <div style="padding: 32px; background: white;">
          <h2>Welcome, ${params.ownerName}!</h2>
          <p>Your gym <strong>${params.gymName}</strong> is now live on GymMind.</p>

          <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <p style="margin: 0 0 8px;"><strong>Your links:</strong></p>
            <p style="margin: 4px 0;">
              📊 Dashboard:
              <a href="https://gymmind.rw/${params.gymSlug}/manager">
                gymmind.rw/${params.gymSlug}/manager
              </a>
            </p>
            <p style="margin: 4px 0;">
              ✅ Check-in screen:
              <a href="https://gymmind.rw/${params.gymSlug}/checkin">
                gymmind.rw/${params.gymSlug}/checkin
              </a>
            </p>
          </div>

          <h3>Getting started:</h3>
          <ol>
            <li>Add your membership plans in the Plans tab</li>
            <li>Import your members from the Import tab</li>
            <li>Download your QR code from Settings</li>
            <li>Place the QR code at your gym entrance</li>
          </ol>

          <p>Need help? Reply to this email.</p>
        </div>

        <div style="background: #f5f5f5; padding: 16px; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #888;">
            GymMind · Made for Rwanda · gymmind.rw
          </p>
        </div>
      </div>
    `,
  });
}

export async function sendMonthlyReport(params: {
  to: string;
  gymName: string;
  gymSlug: string;
  month: string;
  totalCheckins: number;
  activeMembers: number;
  totalRevenue: number;
}): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[EMAIL] Monthly report to: ${params.to}`);
    console.log(`[EMAIL] ${params.gymName} — ${params.month}`);
    console.log(`[EMAIL] ${params.totalCheckins} check-ins | ${params.activeMembers} members | ${params.totalRevenue} RWF`);
    return;
  }

  await transporter.sendMail({
    from:    '"GymMind" <noreply@gymmind.rw>',
    to:      params.to,
    subject: `${params.gymName} — Monthly Report for ${params.month}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0F6E56; padding: 32px; text-align: center;">
          <h1 style="color: white; margin: 0;">GymMind</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">Monthly Summary</p>
        </div>

        <div style="padding: 32px; background: white;">
          <h2 style="margin-top: 0;">${params.gymName}</h2>
          <p style="color: #64748b;">${params.month}</p>

          <div style="display: flex; gap: 16px; margin: 24px 0;">
            <div style="flex: 1; background: #f0fdf4; border-radius: 8px; padding: 20px; text-align: center;">
              <div style="font-size: 32px; font-weight: 800; color: #0F6E56;">${params.totalCheckins}</div>
              <div style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Check-ins</div>
            </div>
            <div style="flex: 1; background: #eff6ff; border-radius: 8px; padding: 20px; text-align: center;">
              <div style="font-size: 32px; font-weight: 800; color: #1d4ed8;">${params.activeMembers}</div>
              <div style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Active Members</div>
            </div>
            <div style="flex: 1; background: #fefce8; border-radius: 8px; padding: 20px; text-align: center;">
              <div style="font-size: 32px; font-weight: 800; color: #92400e;">${params.totalRevenue.toLocaleString()}</div>
              <div style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">RWF Revenue</div>
            </div>
          </div>

          <p>
            <a href="https://gymmind.rw/${params.gymSlug}/manager" style="color: #0F6E56; font-weight: 600;">
              View full dashboard →
            </a>
          </p>
        </div>

        <div style="background: #f5f5f5; padding: 16px; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #888;">
            GymMind · Made for Rwanda · gymmind.rw
          </p>
        </div>
      </div>
    `,
  });
}
