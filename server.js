const express = require("express");
const axios = require("axios");
const pdfParse = require("pdf-parse");
const docxParser = require("docx-parser");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const cors = require('cors');
const { data } = require("autoprefixer");
const { JWT } = require("google-auth-library");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));

app.use(express.json());

async function sendFollowUpEmail(email, name) {
    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: "hiranvith@gmail.com",
                pass: process.env.REACT_APP_GMAIL_APP_PASSWORD,
            },
        });

        const mailOptions = {
            from: "hiranvith@gmail.com",
            to: email,
            subject: "Follow-Up: Your CV is Under Review",
            text: `Hello ${name},\n\nThank you for submitting your CV. We are reviewing your application and will get back to you soon.\n\nBest regards,\nTeam`
        };

        await transporter.sendMail(mailOptions);
        console.log("Follow-Up email send Success");
    } catch (error) {
        console.log("Follow up email send failed: ", error.message);
    }
}

async function addToGoogleSheet(data) {
    try {


        // Use the new auth method
        // const useServiceAccountAuth = new JWT({
        //     keyFile: './androidproject-449103-dac7101a8cd7',
        //     scopes: [
        //         'https://www.googleapis.com/auth/spreadsheets',
        //     ],
        // });

        const useServiceAccountAuth = new JWT({
            email: process.env.GOOGLE_CLIENT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
            ],
        });
        const doc = new GoogleSpreadsheet(process.env.REACT_APP_GOOGLE_SHEET_ID, useServiceAccountAuth)
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.loadHeaderRow();
        console.log("Loaded Headers:", sheet.headerValues);

        const rowData = {
            Name: data.name,
            Email: data.email,
            Phone: data.phone,
            Education: data.education.join('\n'),
            Qualifications: data.qualifications.join('\n'),
            Projects: data.projects.join('\n'),
            cvUrl: data.cvUrl
        }
        await sheet.addRow(rowData);
        console.log(data.cvUrl);
        console.log("Data added to Google Sheet successfully");
    } catch (error) {
        console.error("Error adding data to Google Sheet:", error);
        throw new Error(`Failed to add data to Google Sheet: ${error.message}`);
    }
}

function extractInfo(text) {
    const namePatterns = [/Name:\s*(.+?)(?:\n|$)/, /Name\s*:\s*(.+?)(?:\n|$)/, /^(.+?)(?:\n|$)/];
    const emailPatterns = [/Email:\s*(.+?)(?:\n|$)/, /Email\s*:\s*(.+?)(?:\n|$)/, /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/];
    const phonePatterns = [/Phone:\s*(.+?)(?:\n|$)/, /Phone\s*:\s*(.+?)(?:\n|$)/, /Tel(?:ephone)?:\s*(.+?)(?:\n|$)/, /Mobile:\s*(.+?)(?:\n|$)/, /Contact:\s*(.+?)(?:\n|$)/];
    const educationPatterns = [/Education:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/, /Education\s*:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/, /Academic Background:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/];
    const qualificationsPatterns = [/Qualifications:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/, /Qualifications\s*:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/, /Skills:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/];
    const projectsPatterns = [/Projects:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/, /Projects\s*:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/, /Experience:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/];



    const extractWithPatterns = (patterns) => {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        return "N/A";
    };
    const education = extractWithPatterns(educationPatterns);
    const educationList = education.split('\n').map(item => item.trim()).filter(item => item !== "");

    const qualifications = extractWithPatterns(qualificationsPatterns);
    const qualificationsList = qualifications.split('\n').map(item => item.trim()).filter(item => item !== "");

    const projects = extractWithPatterns(projectsPatterns);
    const projectsList = projects.split('\n').map(item => item.trim()).filter(item => item !== "");

    return {
        name: extractWithPatterns(namePatterns),
        email: extractWithPatterns(emailPatterns),
        phone: extractWithPatterns(phonePatterns),
        education: educationList,
        qualifications: qualificationsList,
        projects: projectsList
    };
}

async function parsePdf(fileBuffer) {
    try {
        const data = await pdfParse(fileBuffer);
        return data.text;
    } catch (error) {
        console.error("Error parsing PDF:", error);
        throw new Error(`Failed to parse PDF: ${error.message}`);
    }
}

async function parseDocx(filePath) {
    return new Promise((resolve, reject) => {
        docxParser.parseDocx(filePath, (data) => {
            resolve(data);
        });
    });
}

async function sendWebHook(payload) {
    try {
        const response = await axios.post("https://rnd-assignment.automations-3d6.workers.dev/", payload, {
            headers: {
                "Content-Type": "application/json",
                "X-Candidate-Email": "hiranyevithange916@gmail.com"
            },
            timeout: 10000
        });
        console.log("webhook sent successfully");
        return response;
    } catch (error) {
        console.error("Failed to send webhook:", error.response?.data || error.message);
        throw new Error(`Failed to send webhook: ${error.response?.data || error.message}`);
    }
}

app.post("/parse-cv", async (req, resp) => {
    try {
        const { cloudinaryUrl, status, applicant_name, applicant_email } = req.body;
        if (!cloudinaryUrl) {
            return resp.status(400).json({ error: "Missing cloudinaryUrl in request body" });
        }
        console.log(`Processing CV from: ${cloudinaryUrl}`);


        const response = await axios.get(cloudinaryUrl, { responseType: "arraybuffer", timeout: 15000 });
        const fileBuffer = response.data;

        let cvText = "";
        if (cloudinaryUrl.endsWith(".pdf")) {
            cvText = await parsePdf(fileBuffer);
        } else if (cloudinaryUrl.endsWith(".docx")) {
            const filePath = "temp.docx";
            const fs = require("fs");
            fs.writeFileSync(filePath, fileBuffer);
            cvText = await parseDocx(filePath);
            fs.unlinkSync(filePath);
        } else {
            return resp.status(400).json({ error: "Unsupported file type" });
        }

        const extractedData = extractInfo(cvText);
        extractedData.cvUrl = cloudinaryUrl;

        await addToGoogleSheet(extractedData);

        const webhookPayload = {
            cv_data: {
                personal_info: {
                    name: extractedData.name,
                    email: extractedData.email,
                    phone: extractedData.phone,
                },
                education: extractedData.education,
                qualifications: extractedData.qualifications,
                projects: extractedData.projects,
                cv_public_link: extractedData.cvUrl,
            },
            metadata: {
                applicant_name: "Hiranye Vithanage",
                email: "hiranyevithange916@gmail.com",
                status: "testing",
                cv_processed: true,
                processed_timestamp: new Date().toISOString(),
            },
        };
        await sendWebHook(webhookPayload);
        console.log('Payload: ', webhookPayload);
        const now = new Date();
        const nextDay = new Date(now.setDate(now.getDate() + 1));
        const nextDayAt9am = new Date(nextDay.setHours(9, 0, 0, 0));

        setTimeout(async () => {
            await sendFollowUpEmail(applicant_email, applicant_name);
        }, nextDayAt9am - now);

        resp.json({ message: "CV parsed, Stored, and webhook sent successfully", data });
    } catch (error) {
        console.error("Error parsing CV: ", error.message);
        resp.status(500).json({ error: "Failed to parse CV", details: error.message });
    }
});

const PORT = process.env.REACT_APP_PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}....`);
})
