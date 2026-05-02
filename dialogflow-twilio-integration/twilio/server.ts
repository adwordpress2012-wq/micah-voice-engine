/**
 * Copyright 2019 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import type {AddressInfo} from 'node:net';

const dialogflowSessionClient = require('../botlib/dialogflow_session_client.js');

type TwilioWebhookBody = {
  Body: string;
  From: string;
  [key: string]: unknown;
};

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const projectId = 'Place your dialogflow projectId here';
const accountSid = 'Place your accountSid here';
const authToken = 'Place your authToken here';

// Keep Twilio client initialization available for future outbound usage.
twilio(accountSid, authToken);
const MessagingResponse = twilio.twiml.MessagingResponse;
const sessionClient = new dialogflowSessionClient(projectId);

const port = process.env.PORT ?? '8080';

const listener = app.listen(port, () => {
  const address = listener.address();
  const listeningPort =
    typeof address === 'string' || address === null
      ? port
      : (address as AddressInfo).port;
  console.log(`Your Twilio integration server is listening on port ${listeningPort}`);
});

app.post('/', async (req: Request<unknown, unknown, TwilioWebhookBody>, res: Response): Promise<void> => {
  const body = req.body;
  const text = body.Body;
  const id = body.From;
  const dialogflowResponse = (await sessionClient.detectIntent(text, id, body)).fulfillmentText;
  const twiml = new MessagingResponse();
  twiml.message(dialogflowResponse);
  res.send(twiml.toString());
});

process.on('SIGTERM', () => {
  listener.close(() => {
    console.log('Closing http server.');
    process.exit(0);
  });
});
