import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { sendPasswordVerificationCode } from '../utils/email.js';
import { createInitialCrmTrialSubscription } from '../utils/crmTrial.js';

const router = express.Router();

// Rate limiter for authentication endpoints (register, login, password reset)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // 10 attempts per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many authentication attempts. Please try again after 15 minutes.'
    }
});

// @route   POST /api/auth/register
// @desc    Register new user
// @access  Public
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

        // Validate input
        if (!normalizedEmail || typeof password !== 'string' || !password || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email, password and name'
            });
        }

        // Check if user exists
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Create user
        const user = new User({
            email: normalizedEmail,
            password,
            name
        });

        await user.save();
        await createInitialCrmTrialSubscription({ userId: user._id });

        // Generate token
        const token = generateToken(user._id, user.tokenVersion);

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            data: {
                user: user.toJSON(),
                token
            }
        });
    } catch (error) {
        console.error('Register error:', error.name, error.code);

        // Handle duplicate key error (email already exists)
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Handle validation errors
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

        // Validate input
        if (!normalizedEmail || typeof password !== 'string' || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        // Find user
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Update last login and last active without triggering password re-hash
        const loginTime = new Date();
        await User.updateOne({ _id: user._id }, { lastLogin: loginTime, lastActiveAt: loginTime });

        // Generate token
        const token = generateToken(user._id, user.tokenVersion);

        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: user.toJSON(),
                token
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        // Account-wide revocation is persisted across replicas and restarts.
        await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
        res.clearCookie('token');
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error.name);
        res.status(500).json({ success: false, message: 'Server error during logout' });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        res.json({
            success: true,
            data: { user }
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const {
            name,
            avatar,
            backgroundImage,
            bio,
            skills,
            phone,
            location,
            birthDate,
            showBirthDate,
            socials,
            featuredWorks,
            attachments,
            preferences
        } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (avatar !== undefined) updateData.avatar = avatar;
        if (backgroundImage !== undefined) updateData.backgroundImage = backgroundImage;
        if (bio !== undefined) updateData.bio = bio;
        if (skills !== undefined) updateData.skills = skills;
        if (phone !== undefined) updateData.phone = phone;
        if (location !== undefined) updateData.location = location;
        if (birthDate !== undefined) updateData.birthDate = birthDate;
        if (showBirthDate !== undefined) updateData.showBirthDate = showBirthDate;
        if (socials !== undefined) updateData.socials = socials;
        if (featuredWorks !== undefined) {
            // Limit to reasonable number of featured works
            updateData.featuredWorks = featuredWorks.slice(0, 10);
        }
        if (attachments !== undefined) {
            // Limit to 3 attachments
            updateData.attachments = attachments.slice(0, 3);
        }
        if (preferences !== undefined && preferences && typeof preferences === 'object') {
            if (typeof preferences.interiorTwoStepConfirm === 'boolean') {
                updateData['preferences.interiorTwoStepConfirm'] = preferences.interiorTwoStepConfirm;
            }
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        res.json({
            success: true,
            message: 'Profile updated',
            data: { user }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @route   POST /api/auth/send-password-code
// @desc    Send verification code to email for password change
// @access  Private
router.post('/send-password-code', authLimiter, authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('+passwordResetCode +passwordResetExpires');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Rate limit: don't send if code was sent less than 60s ago
        if (user.passwordResetExpires && user.passwordResetCode) {
            const timeSinceIssued = Date.now() - (user.passwordResetExpires.getTime() - 10 * 60 * 1000);
            if (timeSinceIssued < 60 * 1000) {
                return res.status(429).json({
                    success: false,
                    message: 'Please wait before requesting a new code'
                });
            }
        }

        // Generate 6-digit code
        const code = crypto.randomInt(100000, 999999).toString();
        user.passwordResetCode = code;
        user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await user.save();

        // Send email
        await sendPasswordVerificationCode(user.email, code, user.name);

        // Mask email for display
        const parts = user.email.split('@');
        const masked = parts[0].slice(0, 2) + '***@' + parts[1];

        res.json({
            success: true,
            message: 'Verification code sent',
            data: { email: masked }
        });
    } catch (error) {
        console.error('Send password code error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send verification code'
        });
    }
});

// @route   PUT /api/auth/password
// @desc    Change password (current password + new password)
// @access  Private
router.put('/password', authLimiter, authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Please provide current password and new password'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters'
            });
        }

        const user = await User.findById(req.user._id);
        if (!user || !user.isActive) {
            return res.status(401).json({ success: false, message: 'Invalid token.' });
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Compare-and-swap prevents stale/concurrent requests from overwriting a
        // new password or undoing revocation. Query updates do not run save hooks.
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const tokenVersion = req.user.tokenVersion ?? 0;
        const versions = [{ tokenVersion }];
        if (tokenVersion === 0) versions.push({ tokenVersion: { $exists: false } });
        const changed = await User.findOneAndUpdate(
            { _id: user._id, password: user.password, isActive: true, $or: versions },
            {
                $set: { password: passwordHash, passwordResetCode: null, passwordResetExpires: null },
                $inc: { tokenVersion: 1 }
            },
            { new: true, runValidators: true }
        );
        if (!changed) {
            return res.status(401).json({ success: false, message: 'Session changed. Please login again.' });
        }
        res.clearCookie('token');

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

export default router;
