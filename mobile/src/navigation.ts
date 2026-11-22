import type { NavigatorScreenParams } from '@react-navigation/native';
import type {
  AnalysisParams,
  ConfirmParams,
  IssueDetailsParams,
  LocationParams,
  ReportParams,
  ReportReviewParams,
  RouteParams,
  TrackParams,
} from './types';

/**
 * Bottom-tab navigator: the persistent chrome of the signed-in app.
 * Map is the landing tab; Report is the always-visible primary action and
 * is handled as a button that pushes Camera on the parent stack rather than
 * a tab screen of its own.
 */
export type RootTabParamList = {
  MapTab: undefined;
  MyReportsTab: undefined;
  ImpactTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  /** Signed-in shell: bottom tabs (Map / Report action / My Reports / Settings). */
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;
  /** Legacy alias kept so existing tests can mount the auth gate directly. */
  Home: undefined;
  Camera: undefined;
  Preview: { photoUri: string };
  Analysis: AnalysisParams;
  Confirm: ConfirmParams;
  Location: LocationParams;
  Report: ReportParams;
  Route: RouteParams;
  ReportReview: ReportReviewParams;
  Track: TrackParams;
  Map: undefined;
  IssueDetails: IssueDetailsParams;
  MyReports: undefined;
  Settings: undefined;
};

export type { NavigatorScreenParams };
