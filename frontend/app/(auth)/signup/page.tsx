import { SignupForm } from '../../../components/auth/SignupForm';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="w-full max-w-md p-8 bg-gray-800 rounded-lg shadow-xl border border-gray-700">
        <h1 className="text-3xl font-bold text-center text-white mb-8">
          Create Account
        </h1>
        <SignupForm />
      </div>
    </div>
  );
}

