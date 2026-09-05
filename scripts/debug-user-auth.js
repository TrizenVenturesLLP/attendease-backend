"use strict";
/**
 * Debug script to check user authentication issue
 * Compile with: npx tsc scripts/debug-user-auth.ts --target ES2020 --module commonjs --esModuleInterop --skipLibCheck
 * Then run with: node scripts/debug-user-auth.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
async function debugUserAuth() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose_1.default.connect(process.env.MONGO_URI);
        console.log('✓ Connected successfully\n');
        const userCollection = mongoose_1.default.connection.collection('users');
        // Find the user with the email from the screenshot
        const targetEmail = 'aasisvenkat@gmail.com';
        const user = await userCollection.findOne({ email: targetEmail });
        if (!user) {
            console.log(`✗ User with email "${targetEmail}" not found in database`);
            return;
        }
        console.log(`User Found:`);
        console.log(`  Email: ${user.email}`);
        console.log(`  First Name: ${user.firstName}`);
        console.log(`  Last Name: ${user.lastName}`);
        console.log(`  Auth Provider: ${user.authProvider}`);
        console.log(`  Is Active: ${user.isActive}`);
        console.log(`  Organization ID: ${user.organizationId}`);
        console.log(`  Has Password Field: ${user.password ? 'Yes' : 'No'}\n`);
        if (!user.password) {
            console.log(`✗ ISSUE: User has no password! Auth Provider is "${user.authProvider}"`);
            if (user.authProvider === 'microsoft') {
                console.log(`  → This user uses Microsoft authentication. They should sign in with Microsoft.\n`);
            }
            return;
        }
        // Check if password is hashed or plain text
        const isHashed = user.password.startsWith('$2a$') ||
            user.password.startsWith('$2b$') ||
            user.password.startsWith('$2y$');
        console.log(`Password Status:`);
        console.log(`  Is Hashed: ${isHashed}`);
        console.log(`  First 20 chars: ${user.password.substring(0, 20)}...\n`);
        if (!isHashed) {
            console.log(`✗ ISSUE FOUND: Password is NOT hashed! It appears to be plain text.`);
            console.log(`  This is why login fails - bcrypt.compare() cannot validate plain text.\n`);
            // Try to fix it
            console.log(`Attempting to fix by hashing the password...`);
            const salt = await bcrypt_1.default.genSalt(10);
            const hashedPassword = await bcrypt_1.default.hash(user.password, salt);
            await userCollection.updateOne({ _id: user._id }, { $set: { password: hashedPassword } });
            console.log(`✓ Password has been hashed and updated in the database!\n`);
            // Verify the fix
            console.log(`Verifying the fix...`);
            const testPassword = '123456'; // The password from the screenshot
            const isValid = await bcrypt_1.default.compare(testPassword, hashedPassword);
            if (isValid) {
                console.log(`✓ Password verification successful! Login should now work.\n`);
            }
            else {
                console.log(`✗ Password verification failed. The stored password might be different.\n`);
            }
        }
        else {
            console.log(`✓ Password is properly hashed.\n`);
            // Try to verify the password from the screenshot
            console.log(`Testing password comparison...`);
            const testPassword = '123456'; // The password from the screenshot
            const isValid = await bcrypt_1.default.compare(testPassword, user.password);
            if (isValid) {
                console.log(`✓ Password "123456" matches the hash!`);
                console.log(`  → Login should work. Check if user is inactive or other issues.\n`);
            }
            else {
                console.log(`✗ Password "123456" does NOT match the hash.`);
                console.log(`  → The stored password is different. The user needs to reset their password.\n`);
            }
        }
    }
    catch (error) {
        console.error('Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('\nMake sure MongoDB is running and accessible.');
        }
    }
    finally {
        await mongoose_1.default.connection.close();
        console.log('Database connection closed');
    }
}
debugUserAuth();
