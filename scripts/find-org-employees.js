#!/usr/bin/env node
"use strict";
/**
 * Find organization by email and list all employees
 * Run with: node scripts/find-org-employees.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });

async function findOrgEmployees() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose_1.default.connect(process.env.MONGO_URI);
        console.log('✓ Connected successfully\n');

        const userCollection = mongoose_1.default.connection.collection('users');
        const orgCollection = mongoose_1.default.connection.collection('organizations');

        // Find the user with the email
        const targetEmail = 'aasishvenkat@gmail.com';
        const user = await userCollection.findOne({ email: targetEmail });

        if (!user) {
            console.log(`✗ User with email "${targetEmail}" not found in database\n`);
            await mongoose_1.default.disconnect();
            return;
        }

        console.log(`User Found:`);
        console.log(`  Email: ${user.email}`);
        console.log(`  Name: ${user.firstName} ${user.lastName}`);
        console.log(`  Role: ${user.role}`);
        console.log(`  Organization ID: ${user.organizationId}\n`);

        // Get organization details
        const org = await orgCollection.findOne({ _id: user.organizationId });
        if (!org) {
            console.log(`✗ Organization not found\n`);
            await mongoose_1.default.disconnect();
            return;
        }

        console.log(`Organization:`);
        console.log(`  Name: ${org.name}`);
        console.log(`  ID: ${org._id}`);
        console.log(`  Created: ${org.createdAt}\n`);

        // Get all employees in this organization
        const employees = await userCollection
            .find({ organizationId: user.organizationId, isActive: true })
            .sort({ role: 1, firstName: 1 })
            .toArray();

        console.log(`Total Active Employees: ${employees.length}\n`);
        console.log(`Employees by Role:\n`);

        // Group by role
        const roleGroups = {};
        employees.forEach(emp => {
            if (!roleGroups[emp.role]) {
                roleGroups[emp.role] = [];
            }
            roleGroups[emp.role].push(emp);
        });

        // Display grouped by role
        Object.keys(roleGroups).sort().forEach(role => {
            console.log(`  ${role.toUpperCase()}:`);
            roleGroups[role].forEach(emp => {
                const dept = emp.department ? ` (${emp.department})` : '';
                const empId = emp.employeeId ? ` [${emp.employeeId}]` : '';
                console.log(`    - ${emp.firstName} ${emp.lastName}${empId}${dept}`);
            });
            console.log('');
        });

        // Summary
        console.log(`Summary by Role:`);
        Object.keys(roleGroups).sort().forEach(role => {
            console.log(`  ${role}: ${roleGroups[role].length}`);
        });

        await mongoose_1.default.disconnect();
    } catch (error) {
        console.error('Error:', error.message);
        await mongoose_1.default.disconnect();
        process.exit(1);
    }
}

findOrgEmployees();
