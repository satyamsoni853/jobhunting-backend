import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import nodemailer from 'nodemailer';
import multer from 'multer';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Setup Multer memory storage (keeps file attachments in memory as a buffer, no temp files on disk)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Basic root route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the ColdMailer Backend API!' });
});

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'healthy',
    message: 'Backend is connected and working perfectly!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Endpoint to verify SMTP credentials before starting a campaign
app.post('/api/verify-smtp', async (req, res) => {
  const { senderEmail, appPassword } = req.body;

  if (!senderEmail || !appPassword) {
    return res.status(400).json({ error: 'Sender email and app password are required.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: senderEmail,
        pass: appPassword
      }
    });

    // Test SMTP credentials
    await transporter.verify();
    res.json({ status: 'valid', message: 'SMTP credentials verified successfully!' });
  } catch (error) {
    console.error('❌ SMTP verification failed:', error);
    res.status(401).json({ 
      error: 'SMTP authentication failed.', 
      details: error.message 
    });
  }
});

// Endpoint to send a single email (enables fine-grained front-end pause/resume/stop control)
app.post('/api/send-single-email', upload.single('resume'), async (req, res) => {
  const { senderEmail, appPassword, subject, body, recipient } = req.body;
  const resumeFile = req.file;

  if (!senderEmail || !appPassword || !subject || !body || !recipient) {
    return res.status(400).json({ error: 'All fields (sender, credentials, subject, body, and recipient) are required.' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: senderEmail,
      pass: appPassword
    }
  });

  try {
    const mailOptions = {
      from: `"${senderEmail.split('@')[0]}" <${senderEmail}>`,
      to: recipient.trim(),
      subject: subject,
      text: body,
      attachments: resumeFile ? [
        {
          filename: resumeFile.originalname,
          content: resumeFile.buffer
        }
      ] : []
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✔️ Success: Sent single mail to ${recipient} (Message ID: ${info.messageId})`);
    res.json({ status: 'success', messageId: info.messageId });
  } catch (error) {
    console.error(`❌ Failed: Sent single mail to ${recipient}. Error:`, error.message);
    res.status(500).json({ status: 'failed', error: error.message });
  }
});

// Endpoint to dispatch emails in a full backend loop (bulk backup endpoint)
app.post('/api/send-emails', upload.single('resume'), async (req, res) => {
  const { senderEmail, appPassword, subject, body, recipients } = req.body;
  const resumeFile = req.file;

  if (!senderEmail || !appPassword || !subject || !body || !recipients) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const recipientList = recipients
    .split(/[\n,;]+/)
    .map(email => email.trim())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  if (recipientList.length === 0) {
    return res.status(400).json({ error: 'No valid recipient email addresses found.' });
  }

  console.log(`📬 Starting bulk email campaign from ${senderEmail} to ${recipientList.length} recipient(s)...`);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: senderEmail,
      pass: appPassword
    }
  });

  const results = [];

  for (let i = 0; i < recipientList.length; i++) {
    const recipient = recipientList[i];
    try {
      const mailOptions = {
        from: `"${senderEmail.split('@')[0]}" <${senderEmail}>`,
        to: recipient,
        subject: subject,
        text: body,
        attachments: resumeFile ? [
          {
            filename: resumeFile.originalname,
            content: resumeFile.buffer
          }
        ] : []
      };

      const info = await transporter.sendMail(mailOptions);
      results.push({ email: recipient, status: 'success', messageId: info.messageId });

      if (i < recipientList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (sendError) {
      results.push({ email: recipient, status: 'failed', error: sendError.message });
    }
  }

  res.json({
    summary: {
      total: recipientList.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length
    },
    results: results
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`👉 Access API at http://localhost:${PORT}`);
});
