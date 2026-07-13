import nodemailer from 'nodemailer';
import { env } from '../config/env.ts';

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465, // true for 465, false for other ports
  auth: {
    user: env.smtp.user,
    pass: env.smtp.pass,
  },
});

/**
 * Sends a 6-digit OTP to the user's email for password reset.
 */
export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const mailOptions = {
    from: `"OCTFIS Support" <${env.smtp.from}>`,
    to,
    subject: 'Your Password Reset OTP - OCTFIS',
    text: `Your OTP for resetting your password is: ${otp}\n\nThis OTP is valid for 10 minutes.\nIf you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #18222e;">
        <h2 style="color: #1c7c8c;">Password Reset Request</h2>
        <p>You requested to reset your password. Use the OTP below to proceed:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 20px; background: #f3f5f9; border-radius: 8px; text-align: center; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #51607a; font-size: 14px;">This OTP is valid for 10 minutes.</p>
        <p style="color: #51607a; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}
