import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { tokenInterceptor } from './token.interceptor';
import { AuthenticationService } from './services/authentication.service';
import { ToastService } from '@app/services/toast/toast.service';
import { SKIP_ERROR_TOAST } from './skip-error-toast.context';

describe('Owner group auth versus guest auth', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['error']);
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([tokenInterceptor])), provideHttpClientTesting(),
      { provide: ToastService, useValue: toast },
      { provide: AuthenticationService, useValue: { getTokens: () => ({ idToken: 'owner-test-token' }) } },
    ] });
    http = TestBed.inject(HttpClient); controller = TestBed.inject(HttpTestingController);
  });
  afterEach(() => controller.verify());
  it('attaches Owner Cognito token to sessions snapshot and DELETE', () => {
    for (const method of ['GET', 'DELETE']) {
      const url = 'https://api.test/guest/groups/group/sessions' + (method === 'DELETE' ? '/guest' : '');
      http.request(method, url).subscribe(); const request = controller.expectOne(url);
      expect(request.request.headers.get('Authorization')).toBe('Bearer owner-test-token'); request.flush({});
    }
  });
  it('attaches Cognito auth to read-only Owner state query', () => {
    const url = 'https://api.test/reservations/r/guest-session-id?view=state';
    http.get(url).subscribe();
    const request = controller.expectOne(url);
    expect(request.request.headers.get('Authorization')).toBe('Bearer owner-test-token');
    request.flush({ status: 'Submitted' });
  });
  it('does not replace the guest token on existing guest cart requests', () => {
    const url = 'https://api.test/guest/sessions/guest';
    http.get(url, { headers: { Authorization: 'Bearer guest-test-token' } }).subscribe();
    const request = controller.expectOne(url); expect(request.request.headers.get('Authorization')).toBe('Bearer guest-test-token'); request.flush({});
  });
  it('silent public guest status errors produce no toast', () => {
    const url = 'https://api.test/guest/groups/group/status';
    http.get(url, { context: new HttpContext().set(SKIP_ERROR_TOAST, true) }).subscribe({ error: () => {} });
    controller.expectOne(url).flush({}, { status: 500, statusText: 'Error' }); expect(toast.error).not.toHaveBeenCalled();
  });
  it('silent Owner snapshot errors produce no toast', () => {
    const url = 'https://api.test/guest/groups/group/sessions';
    http.get(url, { context: new HttpContext().set(SKIP_ERROR_TOAST, true) }).subscribe({ error: () => {} });
    controller.expectOne(url).flush({}, { status: 500, statusText: 'Error' }); expect(toast.error).not.toHaveBeenCalled();
  });
});
