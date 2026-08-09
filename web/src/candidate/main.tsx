/**
 * Candidate shell entry point.
 *
 * Three destinations and nothing else:
 *   /              a neutral landing page
 *   /t/:token      the assessment
 *   /r/:token      a report
 *
 * There is deliberately no navigation to the admin console anywhere in this
 * bundle — administrators reach it by typing /admin.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '../styles/base.css';
import '../styles/candidate.css';
import { Landing } from './Landing.js';
import { AssessmentPage } from './AssessmentPage.js';
import { ReportPage } from './ReportPage.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/t/:token" element={<AssessmentPage />} />
        <Route path="/r/:token" element={<ReportPage source="report" />} />
        <Route path="/t/:token/report" element={<ReportPage source="link" />} />
        <Route path="*" element={<Landing notFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
