const express = require("express");
const controller = require("../controllers/erss.controller");

const router = express.Router();

router.get("/events", controller.listEvents);
router.post("/events", controller.createEvent);
router.post("/events/simulate", controller.simulateEvent);
router.get("/events/:id", controller.getEvent);
router.patch("/events/:id", controller.updateEvent);
router.post("/events/:id/location", controller.updateLocation);
router.post("/events/:id/jurisdiction", controller.updateJurisdiction);

router.get("/events/:id/calls", controller.listCalls);
router.post("/events/:id/calls", controller.createCall);
router.patch("/calls/:callId", controller.updateCall);
router.post("/calls/:callId/end", controller.endCall);

router.post("/events/:id/triage", controller.createTriage);
router.get("/events/:id/triage", controller.getTriage);

router.post("/events/:id/dispatch-request", controller.createDispatchRequest);
router.get("/events/:id/dispatch-request", controller.getDispatchRequest);
router.post("/dispatch-requests/:requestId/approve", controller.approveDispatchRequest);
router.post("/dispatch-requests/:requestId/reject", controller.rejectDispatchRequest);

router.post("/dispatch-requests/:requestId/unit-requests", controller.createUnitRequest);
router.get("/dispatch-requests/:requestId/unit-requests", controller.listUnitRequests);
router.post("/unit-requests/:requestId/acknowledge", controller.acknowledgeUnitRequest);
router.post("/unit-requests/:requestId/accept", controller.acceptUnitRequest);
router.post("/unit-requests/:requestId/decline", controller.declineUnitRequest);
router.post("/unit-requests/:requestId/timeout", controller.timeoutUnitRequest);
router.post("/events/:id/fallback-unit", controller.recommendFallbackUnit);

router.post("/events/:id/assistance-requests", controller.createAssistanceRequest);
router.get("/events/:id/assistance-requests", controller.listAssistanceRequests);
router.post("/assistance-requests/:requestId/acknowledge", controller.acknowledgeAssistanceRequest);
router.post("/assistance-requests/:requestId/accept", controller.acceptAssistanceRequest);
router.post("/assistance-requests/:requestId/decline", controller.declineAssistanceRequest);
router.post("/assistance-requests/:requestId/timeout", controller.timeoutAssistanceRequest);

router.post("/events/:id/ownership-transfer", controller.createOwnershipTransfer);
router.get("/events/:id/ownership-transfers", controller.listOwnershipTransfers);
router.post("/ownership-transfers/:transferId/acknowledge", controller.acknowledgeOwnershipTransfer);
router.post("/ownership-transfers/:transferId/complete", controller.completeOwnershipTransfer);

router.get("/jurisdiction-history/:eventId", controller.getJurisdictionHistory);
router.get("/dispatcher/:dispatcherId/workload", controller.getDispatcherWorkload);
router.get("/supervisor/queue", controller.getSupervisorQueue);

router.get("/events/:id/recommendations", controller.getRecommendations);
router.post("/events/:id/recommendations/refresh", controller.refreshRecommendations);

module.exports = router;