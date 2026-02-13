import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Send verification code email for password change
 * @param {string} to - recipient email
 * @param {string} code - 6-digit verification code
 * @param {string} name - user's name
 */
export const sendPasswordVerificationCode = async (to, code, name) => {
    const mailOptions = {
        from: `"Alpha Studio" <${process.env.EMAIL_USER}>`,
        to,
        subject: 'Password Change Verification Code - Alpha Studio',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #1a1a2e; border-radius: 16px; color: #fff;">
                <h2 style="color: #a855f7; margin-bottom: 8px;">Alpha Studio</h2>
                <p style="color: #ccc; margin-bottom: 24px;">Hi ${name},</p>
                <p style="color: #ccc; margin-bottom: 24px;">Your verification code for password change:</p>
                <div style="background: #2d2d44; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #a855f7;">${code}</span>
                </div>
                <p style="color: #999; font-size: 14px;">This code expires in 10 minutes.</p>
                <p style="color: #999; font-size: 14px;">If you didn't request this, please ignore this email.</p>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};

export default transporter;
