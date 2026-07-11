import mongoose from 'mongoose';
import connectDB from '../config/db';
import User from '../models/User';
import FieldTrackingSession from '../models/FieldTrackingSession';
import FieldLocationPoint from '../models/FieldLocationPoint';
import OfficeLocation from '../models/OfficeLocation';

async function main() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    
    console.log('Querying office locations...');
    const locations = await OfficeLocation.find({}).lean();
    console.log(`Found ${locations.length} office locations:`);
    for (const loc of locations) {
      console.log(`- Name: ${loc.name}, Lat/Lng: ${loc.latitude}, ${loc.longitude}, Radius: ${loc.radiusMeters}m`);
    }

    console.log('Querying users...');
    const users = await User.find({}).lean();
    console.log(`Found ${users.length} users.`);
    
    console.log('\nQuerying active tracking sessions for all users...');
    const activeSessions = await FieldTrackingSession.find({
      status: 'active'
    }).lean();
    
    console.log(`Found ${activeSessions.length} active sessions:`);
    for (const s of activeSessions) {
      const u = users.find(usr => usr._id.toString() === s.userId.toString());
      console.log(`- Session ID: ${s._id}, User: ${u ? u.firstName + ' ' + u.lastName : s.userId}, Status: ${s.status}, LastLocation:`, s.lastLocation);
    }
    
    if (activeSessions.length > 0) {
      console.log('\nQuerying last 15 location points in the system...');
      const points = await FieldLocationPoint.find({})
      .sort({ recordedAt: -1 })
      .limit(15)
      .lean();
      
      console.log(`Found ${points.length} points:`);
      for (const p of points) {
        const u = users.find(usr => usr._id.toString() === p.userId.toString());
        console.log(`- Point ID: ${p._id}, User: ${u ? u.firstName + ' ' + u.lastName : p.userId}, Lat/Lng: ${p.latitude}, ${p.longitude}, RecordedAt: ${p.recordedAt}`);
      }
    }
    
    await mongoose.disconnect();
    console.log('Disconnected.');
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
