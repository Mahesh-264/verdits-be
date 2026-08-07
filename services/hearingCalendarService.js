const User = require('../models/User');
const Client = require('../models/Client');
const {
  hearingEventResource,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} = require('./googleCalendarService');

const connectedCalendarOwner = async (hearing) => User.findById(hearing.createdBy).select('+googleCalendar.refreshToken');

const eventResourceFor = async (hearing, legalCase) => {
  const [lawyer, client] = await Promise.all([
    connectedCalendarOwner(hearing),
    legalCase.clientId ? Client.findById(legalCase.clientId).lean() : null,
  ]);
  if (!lawyer?.googleCalendar?.connected || !lawyer.googleCalendar.refreshToken) return null;
  return { lawyer, resource: hearingEventResource({ hearing, legalCase, client, lawyer }) };
};

const createHearingCalendarEvent = async (hearing, legalCase) => {
  try {
    const data = await eventResourceFor(hearing, legalCase);
    if (!data) return;
    const eventId = await createCalendarEvent(data.lawyer.googleCalendar.refreshToken, data.resource);
    await hearing.constructor.updateOne({ _id: hearing._id, googleEventId: null }, { $set: { googleEventId: eventId } });
    hearing.googleEventId = eventId;
    console.log('Calendar Event Created', { hearingId: String(hearing._id), eventId });
  } catch (error) {
    console.error('Google Calendar event creation failed:', error.message);
  }
};

const updateHearingCalendarEvent = async (hearing, legalCase) => {
  if (!hearing.googleEventId) return;
  try {
    const data = await eventResourceFor(hearing, legalCase);
    if (!data) return;
    await updateCalendarEvent(data.lawyer.googleCalendar.refreshToken, hearing.googleEventId, data.resource);
    console.log('Calendar Event Updated', { hearingId: String(hearing._id), eventId: hearing.googleEventId });
  } catch (error) {
    console.error('Google Calendar event update failed:', error.message);
  }
};

const deleteHearingCalendarEvent = async (hearing) => {
  if (!hearing.googleEventId) return;
  try {
    const lawyer = await connectedCalendarOwner(hearing);
    if (!lawyer?.googleCalendar?.connected || !lawyer.googleCalendar.refreshToken) return;
    await deleteCalendarEvent(lawyer.googleCalendar.refreshToken, hearing.googleEventId);
    console.log('Calendar Event Deleted', { hearingId: String(hearing._id), eventId: hearing.googleEventId });
  } catch (error) {
    console.error('Google Calendar event deletion failed:', error.message);
  }
};

module.exports = { createHearingCalendarEvent, updateHearingCalendarEvent, deleteHearingCalendarEvent };
