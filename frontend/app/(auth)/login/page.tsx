import { LoginForm } from '../../../components/auth/LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="w-full max-w-md p-4 sm:p-8 bg-gray-800 rounded-lg shadow-xl border border-gray-700">
        <h1 className="text-3xl font-bold text-center text-white mb-8">
          Login to Crypto Dashboard
        </h1>
        <LoginForm />
      </div>
    </div>
  );
}

