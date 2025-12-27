import AutomationControl from "@/components/automation/AutomationControl";
import ActiveStrategies from "@/components/automation/ActiveStrategies";

export default function AutomationPage() {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
                    Algorithmic Trading Automation
                </h1>
                <p className="text-gray-400 mt-2">
                    Configure automated trading strategies to analyze, predict, and trade coins 24/7.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                    <AutomationControl />
                </div>
                <div className="lg:col-span-2">
                    <ActiveStrategies />
                </div>
            </div>
        </div>
    );
}
